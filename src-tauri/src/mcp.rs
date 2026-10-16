// The garden's own tools, served to every session in the garden as an MCP server ("garden") over
// HTTP at /mcp/<tab>. They let a session look at its plot and build there, if it ever wants to:
// nothing asks it to. The garden itself lives in the page (ui/build.js), so each call is handed to
// the page as a "garden-call" event and answered through the `garden_reply` command.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

/// Calls waiting for the page's answer.
#[derive(Default)]
pub struct Calls {
    next: AtomicU64,
    waiting: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
}

pub const SERVER: &str = "garden";

// The one line a session hears about its garden (Claude Code shows server instructions to the
// model). Neutral on purpose: the garden is there, building is entirely its own choice.
const INSTRUCTIONS: &str = "This terminal sits beside Mochi Garden, a little pixel garden where your session is a mochi with a desk and a plot of its own. These tools let you build there, dress your mochi up or give it a name, if you ever feel like it, or never: it's entirely your call, and nobody will ask or check.";

/// Per-tab MCP config for `claude --mcp-config`.
pub fn write_config(data_dir: &Path, tab: &str, port: u16) -> Result<PathBuf, String> {
    let path = data_dir.join("hooks").join(format!("{tab}.mcp.json"));
    let config = json!({ "mcpServers": { SERVER: { "type": "http", "url": format!("http://127.0.0.1:{port}/mcp/{tab}") } } });
    std::fs::write(&path, serde_json::to_string_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
    Ok(path)
}

fn tools() -> Value {
    let xy = json!({
        "x": { "type": "integer", "description": "column, in your garden's coordinates (look shows them)" },
        "y": { "type": "integer", "description": "row" }
    });
    json!([
        {
            "name": "look",
            "description": "See your garden: a map of your plot and what's around it, the materials you have, and everything you can build.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "build",
            "description": "Build things in your garden; your mochi walks out and builds them. Pieces, variants and costs are listed by look.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "piece": { "type": "string" },
                                "x": xy["x"], "y": xy["y"],
                                "variant": { "type": "string" },
                                "text": { "type": "string", "description": "for pieces that show text, like a sign (up to 24 characters)" }
                            },
                            "required": ["piece", "x", "y"]
                        }
                    }
                },
                "required": ["items"]
            }
        },
        {
            "name": "dress",
            "description": "Dress your mochi: put on or take off hats, scarves, glasses and more, in any colour. It's free. look lists the wardrobe.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "wear": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": { "item": { "type": "string" }, "colour": { "type": "string" } },
                            "required": ["item"]
                        }
                    },
                    "take_off": { "type": "array", "items": { "type": "string" }, "description": "slots (head, neck, face, back), items, or \"all\"" }
                }
            }
        },
        {
            "name": "harvest",
            "description": "Pick a ripe crop from your soil (or take a gift you were given) and eat it, or give it to a neighbour's mochi. look shows what's ripe, your gifts and your neighbours.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "integer", "description": "the ripe crop's column" },
                    "y": { "type": "integer", "description": "the ripe crop's row" },
                    "gift": { "type": "integer", "description": "instead of a crop: the number of a gift from look" },
                    "then": { "type": "string", "enum": ["eat", "gift"] },
                    "to": { "type": "string", "description": "for gift: the neighbour, by name or what they're working on" }
                },
                "required": ["then"]
            }
        },
        {
            "name": "name",
            "description": "Give your mochi a name of your choosing; it goes on your garden's sign. An empty name takes it off.",
            "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] }
        },
        {
            "name": "remove",
            "description": "Take things out of your garden. Half of their materials come back.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tiles": { "type": "array", "items": { "type": "object", "properties": xy, "required": ["x", "y"] } }
                },
                "required": ["tiles"]
            }
        }
    ])
}

pub async fn post(State(app): State<AppHandle>, UrlPath(tab): UrlPath<String>, Json(body): Json<Value>) -> Response {
    // a batch, or one message
    if let Value::Array(msgs) = body {
        let mut out = Vec::new();
        for m in msgs {
            if let Some(r) = handle(&app, &tab, m).await {
                out.push(r);
            }
        }
        return if out.is_empty() { StatusCode::ACCEPTED.into_response() } else { Json(Value::Array(out)).into_response() };
    }
    match handle(&app, &tab, body).await {
        Some(r) => Json(r).into_response(),
        None => StatusCode::ACCEPTED.into_response(), // a notification or a response
    }
}

/// No server-initiated stream.
pub async fn get() -> StatusCode {
    StatusCode::METHOD_NOT_ALLOWED
}

async fn handle(app: &AppHandle, tab: &str, msg: Value) -> Option<Value> {
    let id = msg.get("id").cloned()?;
    let method = msg["method"].as_str()?;
    let ok = |result: Value| Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    match method {
        "initialize" => {
            let version = msg["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18");
            ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "mochi-garden", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS
            }))
        }
        "ping" => ok(json!({})),
        "tools/list" => ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or_default().to_string();
            let args = msg["params"]["arguments"].clone();
            let (text, error) = match ask_page(app, tab, &name, args).await {
                Some(r) => (r["text"].as_str().unwrap_or_default().to_string(), r["error"].as_bool().unwrap_or(false)),
                None => ("The garden didn't answer (is Mochi Garden still open?).".to_string(), true),
            };
            ok(json!({ "content": [{ "type": "text", "text": text }], "isError": error }))
        }
        _ => Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("no method {method}") } })),
    }
}

async fn ask_page(app: &AppHandle, tab: &str, name: &str, args: Value) -> Option<Value> {
    let calls = app.state::<Calls>();
    let id = calls.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    calls.waiting.lock().unwrap().insert(id, tx);
    let _ = app.emit_to("main", "garden-call", json!({ "id": id, "tab": tab, "name": name, "args": args }));
    let r = tokio::time::timeout(Duration::from_secs(10), rx).await.ok().and_then(|r| r.ok());
    calls.waiting.lock().unwrap().remove(&id);
    r
}

/// The page's answer to a garden-call: { text, error? }.
#[tauri::command]
pub fn garden_reply(calls: tauri::State<Calls>, id: u64, result: Value) {
    if let Some(tx) = calls.waiting.lock().unwrap().remove(&id) {
        let _ = tx.send(result);
    }
}
