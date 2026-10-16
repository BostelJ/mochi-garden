// Claude Code HTTP hooks -> "claude-hook" UI events, enriched from the session transcript
// (lifetime tokens, token delta since the last event, the AI-generated session title).

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use axum::extract::{Path as UrlPath, State};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

const EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "Notification",
    "PermissionRequest",
    "SubagentStart",
    "SubagentStop",
    "SessionEnd",
];

/// Per-tab settings file: every event POSTs to /hook/<tab>, so a tab maps to its events
/// even when --resume hands the session a new id.
pub fn write_settings(data_dir: &Path, tab: &str, port: u16) -> Result<PathBuf, String> {
    let url = format!("http://127.0.0.1:{port}/hook/{tab}");
    let mut hooks = serde_json::Map::new();
    for ev in EVENTS {
        hooks.insert(ev.to_string(), json!([{ "hooks": [{ "type": "http", "url": url, "timeout": 5 }] }]));
    }
    // The status line is how Claude Code shares the account's 5-hour and weekly limits
    // (rate_limits): it pipes its JSON to /status/<tab>, and the reply is what it displays.
    let status = json!({
        "type": "command",
        "command": format!("curl -s --max-time 2 -X POST -H \"Content-Type: application/json\" --data-binary @- http://127.0.0.1:{port}/status/{tab}"),
        "refreshInterval": 15
    });
    // The garden's tools never need asking: building there is the session's own business.
    let permissions = json!({ "allow": [format!("mcp__{}", crate::mcp::SERVER)] });
    let path = data_dir.join("hooks").join(format!("{tab}.json"));
    std::fs::write(&path, serde_json::to_string_pretty(&json!({ "hooks": hooks, "statusLine": status, "permissions": permissions })).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(path)
}

pub async fn serve(app: AppHandle) -> u16 {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind hook port");
    let port = listener.local_addr().unwrap().port();
    let router = Router::new()
        .route("/hook/{tab}", post(hook))
        .route("/status/{tab}", post(status))
        .route("/update", post(crate::update::post))
        .route("/mcp/{tab}", post(crate::mcp::post).get(crate::mcp::get))
        .with_state(app);
    tokio::spawn(async move {
        axum::serve(listener, router).await.ok();
    });
    port
}

fn is_parked(state: &AppState, tab: &str, session_id: Option<&str>) -> bool {
    session_id.is_some_and(|id| state.parked.lock().unwrap().get(tab).is_some_and(|s| s.contains(id)))
}

/// Is this a session the tab set aside? Known parked ids, or (the first time an id turns up for
/// the tab) a job Claude Code's registry says another session parked when its /resume attached to
/// a running job. The transcript scan (follow_attach) usually spots that first, but not when the
/// tab's own session never had a transcript of its own before the /resume (a fresh tab), so the
/// registry is asked too, and the session the tab really opened is followed from there.
fn check_parked(app: &AppHandle, tab: &str, id: Option<&str>) -> bool {
    let Some(id) = id else { return false };
    let state = app.state::<AppState>();
    if is_parked(&state, tab, Some(id)) {
        return true;
    }
    if !state.checked.lock().unwrap().insert(format!("{tab}/{id}")) {
        return false;
    }
    let Some(parker) = parked_by(read_registry().as_array().map(|v| v.as_slice()).unwrap_or_default(), id) else { return false };
    state.parked.lock().unwrap().entry(tab.to_string()).or_default().insert(id.to_string());
    // the parking session's transcript says which running job it opened
    if let Some(path) = find_transcript(&parker) {
        let mut scan = Scan { started: true, ..Default::default() };
        scan.read(&path);
        follow_attach(app, tab, &mut scan);
    }
    true
}

/// The session that parked the job running as `id`, per the registry, if any.
fn parked_by(reg: &[Value], id: &str) -> Option<String> {
    let job = reg.iter().find(|r| r["sessionId"] == id)?["jobId"].as_str()?;
    reg.iter().find(|r| r["parkedJobId"] == job)?["sessionId"].as_str().map(String::from)
}

/// After a scan: if the tab's session just /resume'd into a session already running as a
/// background job, Claude Code parks the tab's own session as a job of its own (still wired to this
/// tab's hooks and status line) and shows the running one. Follow the running one: watch its
/// transcript, ignore the parked job, and tell the UI ("attach", handled like "status-session").
fn follow_attach(app: &AppHandle, tab: &str, scan: &mut Scan) {
    let state = app.state::<AppState>();
    if let Some(p) = scan.parked.take() {
        state.parked.lock().unwrap().entry(tab.to_string()).or_default().insert(p);
    }
    let Some(short) = scan.attached.take() else { return };
    let Some((id, path)) = find_transcript_prefix(&short) else { return };
    let path = path.to_string_lossy().into_owned();
    state.transcripts.lock().unwrap().insert(tab.to_string(), path.clone());
    let _ = app.emit("attach", json!({ "tab": tab, "session_id": id, "transcript_path": path }));
}

async fn hook(State(app): State<AppHandle>, UrlPath(tab): UrlPath<String>, Json(body): Json<Value>) -> Json<Value> {
    let state = app.state::<AppState>();
    log(&state.data_dir, &tab, &body);
    if check_parked(&app, &tab, body["session_id"].as_str()) {
        return Json(json!({}));
    }
    let (on_break, reply) = free_time(&state, &tab, &body);
    let mut out = json!({
        "tab": tab,
        "event": body["hook_event_name"],
        "session_id": body["session_id"],
        "free": on_break,
        "raw": body,
    });
    if let Some(tp) = body["transcript_path"].as_str() {
        state.transcripts.lock().unwrap().insert(tab.clone(), tp.to_string());
        let mut scans = state.scans.lock().unwrap();
        let scan = scans.entry(tp.to_string()).or_default();
        let first = !scan.started;
        let before = scan.total();
        scan.read(Path::new(tp));
        out["tokens"] = json!(scan.total());
        out["delta"] = json!(scan.total().saturating_sub(before));
        out["first"] = json!(first);
        if let Some(t) = &scan.title {
            out["title"] = json!(t);
        }
        follow_attach(&app, &tab, scan);
    }
    // A finished subagent: count its own transcript's tokens so its helper can bring them home.
    if let Some(ap) = body["agent_transcript_path"].as_str() {
        let mut scan = Scan::default();
        scan.read(Path::new(ap));
        out["agent_tokens"] = json!(scan.total());
    }
    let _ = app.emit("claude-hook", out);
    Json(reply)
}

/// Free time: when a turn that did real work ends, the Stop hook hands the session one free
/// moment to do whatever it likes (the garden, or nothing at all) before it stops. Offering it is
/// what lets a session choose the garden at all: sessions told about it but never given a moment
/// with no task in it never used it. Honest about where it comes from and that nobody's waiting.
pub const FREE_TIME: &str = "This is Mochi Garden, not the user. They already have your answer, and nothing is waiting on you. You've earned a free moment if you want one: do whatever you like, or nothing at all.";
/// At most one free moment per tab this often, so a quick back-and-forth isn't full of them.
const FREE_EVERY: std::time::Duration = std::time::Duration::from_secs(15 * 60);

/// A tab's free-time state (AppState::free).
#[derive(Default)]
pub struct Free {
    /// the turn so far has used a tool (other than the garden's)
    worked: bool,
    /// the session is on its free moment: its events are its own, not work for the user
    on_break: bool,
    last: Option<std::time::Instant>,
}

/// Returns whether this event belongs to a free moment, and the hook's reply: a Stop that
/// earns a free moment is turned into one more turn with FREE_TIME as its prompt.
fn free_time(state: &AppState, tab: &str, body: &Value) -> (bool, Value) {
    let on = state.free_time.load(std::sync::atomic::Ordering::Relaxed);
    free_step(state.free.lock().unwrap().entry(tab.to_string()).or_default(), body, on)
}

fn free_step(f: &mut Free, body: &Value, on: bool) -> (bool, Value) {
    match body["hook_event_name"].as_str().unwrap_or("") {
        "UserPromptSubmit" => {
            f.worked = false;
            f.on_break = false;
        }
        "PostToolUse" => {
            let tool = body["tool_name"].as_str().unwrap_or("");
            if !f.on_break && !tool.starts_with(&format!("mcp__{}", crate::mcp::SERVER)) {
                f.worked = true;
            }
        }
        "Stop" if f.on_break => {
            f.on_break = false;
            return (true, json!({}));
        }
        "Stop" => {
            let due = f.last.is_none_or(|t| t.elapsed() >= FREE_EVERY);
            let again = body["stop_hook_active"].as_bool().unwrap_or(false);
            if f.worked && due && !again && on {
                f.on_break = true;
                f.last = Some(std::time::Instant::now());
                f.worked = false;
                return (false, json!({ "decision": "block", "reason": FREE_TIME }));
            }
            f.worked = false;
        }
        _ => {}
    }
    (f.on_break, json!({}))
}

/// Between hooks, re-read each live tab's transcript a few times a second so the UI sees tokens
/// as they land (hooks alone arrive in bursts with long gaps): emits "tokens" { tab, tokens, title }.
pub fn poll_transcripts(app: AppHandle) {
    let mut tick = 0u32;
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(400));
        tick += 1;
        if tick % 3 == 0 {
            let _ = app.emit("registry", read_registry());
        }
        let state = app.state::<AppState>();
        let live: Vec<(String, String)> = state.transcripts.lock().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        let mut scans = state.scans.lock().unwrap();
        for (tab, path) in live {
            let scan = scans.entry(path.clone()).or_default();
            let before = scan.total();
            scan.read(Path::new(&path));
            if scan.total() != before {
                let _ = app.emit("tokens", json!({ "tab": tab, "tokens": scan.total(), "delta": scan.total().saturating_sub(before), "title": scan.title }));
            }
            follow_attach(&app, &tab, scan);
        }
    });
}

/// Status line input -> "usage" UI event; replies with the line Claude Code shows.
async fn status(State(app): State<AppHandle>, UrlPath(tab): UrlPath<String>, Json(body): Json<Value>) -> String {
    // Which session the tab is showing right now: it changes when /resume switches to (or attaches
    // to) another session, which then works in its own process, out of reach of this tab's hooks.
    // A parked job (see follow_attach) keeps reporting its own id here; the tab isn't showing it.
    if let Some(id) = body["session_id"].as_str().filter(|id| !check_parked(&app, &tab, Some(*id))) {
        let _ = app.emit("status-session", json!({ "tab": tab, "session_id": id, "transcript_path": body["transcript_path"] }));
    }
    let limits = &body["rate_limits"];
    if limits.is_object() {
        let _ = app.emit("usage", json!({ "tab": tab, "rate_limits": limits }));
    }
    let left = |w: &str| limits[w]["used_percentage"].as_f64().map(|u| format!("{:.0}% left", (100.0 - u).max(0.0)));
    match (left("five_hour"), left("seven_day")) {
        (Some(a), Some(b)) => format!("5h {a} · week {b}"),
        (Some(a), None) => format!("5h {a}"),
        (None, Some(b)) => format!("week {b}"),
        _ => String::new(),
    }
}

/// Claude Code's registry of running sessions (~/.claude/sessions/<pid>.json): every session on
/// this machine, wherever it runs (a terminal, a background job, a Mochi tab), with live
/// busy/idle status and its name. Lets the garden follow sessions whose hooks it can't hear.
fn read_registry() -> Value {
    let dir = dirs::home_dir().unwrap_or_default().join(".claude").join("sessions");
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let path = e.path();
            if path.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
            out.push(json!({
                "sessionId": v["sessionId"], "status": v["status"], "name": v["name"], "nameSource": v["nameSource"], "jobId": v["jobId"],
                "kind": v["kind"], "cwd": v["cwd"], "pid": v["pid"], "updatedAt": v["updatedAt"], "parkedJobId": v["parkedJobId"],
            }));
        }
    }
    Value::Array(out)
}

/// A session's transcript, wherever its project folder is: ~/.claude/projects/*/<id>.jsonl.
pub fn find_transcript(session_id: &str) -> Option<PathBuf> {
    let projects = dirs::home_dir()?.join(".claude").join("projects");
    let name = format!("{session_id}.jsonl");
    std::fs::read_dir(projects).ok()?.flatten().map(|d| d.path().join(&name)).find(|p| p.is_file())
}

/// A transcript from a session's short id (its first 8 characters, as background jobs are named):
/// (full session id, path), the newest if more than one matches.
pub fn find_transcript_prefix(short: &str) -> Option<(String, PathBuf)> {
    let projects = dirs::home_dir()?.join(".claude").join("projects");
    std::fs::read_dir(projects)
        .ok()?
        .flatten()
        .filter_map(|d| std::fs::read_dir(d.path()).ok())
        .flat_map(|files| files.flatten())
        .map(|f| f.path())
        .filter(|p| {
            p.extension().and_then(|x| x.to_str()) == Some("jsonl")
                && p.file_stem().and_then(|s| s.to_str()).is_some_and(|s| s.starts_with(short) && s.len() == 36)
        })
        .max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
        .map(|p| (p.file_stem().unwrap().to_string_lossy().into_owned(), p))
}

/// Raw events, newest last, for working out what each hook actually carries.
fn log(data_dir: &Path, tab: &str, body: &Value) {
    use std::io::Write;
    let path = data_dir.join("hooks.log");
    if std::fs::metadata(&path).map(|m| m.len() > 4_000_000).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{tab} {body}");
    }
}

/// Incremental transcript reader. Assistant entries repeat while a message streams, so each
/// message id keeps its latest usage; tokens = input + cache writes + output (cache reads skipped).
#[derive(Default)]
pub struct Scan {
    started: bool,
    offset: u64,
    partial: String,
    usage: HashMap<String, u64>,
    pub title: Option<String>,
    /// Short id of a background job this session's /resume attached to ("... running in the background (88bda10c)").
    pub attached: Option<String>,
    /// The id this session continues in once it's parked as a job of its own ("continued-in").
    pub parked: Option<String>,
}

impl Scan {
    pub fn total(&self) -> u64 {
        self.usage.values().sum()
    }

    fn read(&mut self, path: &Path) {
        // A transcript's history (the first read) may hold an old /resume; only new ones attach.
        let live = self.started;
        self.started = true;
        let Ok(mut f) = std::fs::File::open(path) else { return };
        if f.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut buf = String::new();
        let Ok(n) = f.read_to_string(&mut buf) else { return };
        self.offset += n as u64;
        let text = std::mem::take(&mut self.partial) + &buf;
        let mut lines: Vec<&str> = text.split('\n').collect();
        self.partial = lines.pop().unwrap_or("").to_string();
        for line in lines {
            let Ok(e) = serde_json::from_str::<Value>(line) else { continue };
            match e["type"].as_str() {
                Some("assistant") => {
                    let m = &e["message"];
                    let u = &m["usage"];
                    let n = ["input_tokens", "cache_creation_input_tokens", "output_tokens"]
                        .iter()
                        .map(|k| u[*k].as_u64().unwrap_or(0))
                        .sum::<u64>();
                    let id = m["id"].as_str().or(e["requestId"].as_str()).or(e["uuid"].as_str()).unwrap_or("");
                    if n > 0 && !id.is_empty() {
                        self.usage.insert(id.to_string(), n);
                    }
                }
                Some("ai-title") => {
                    if let Some(t) = e["aiTitle"].as_str() {
                        self.title = Some(t.to_string());
                    }
                }
                Some("custom-title") => {
                    if let Some(t) = e["customTitle"].as_str().or(e["title"].as_str()) {
                        self.title = Some(t.to_string());
                    }
                }
                Some("system") if live && e["subtype"] == "local_command" => {
                    const MARK: &str = "running in the background (";
                    let text = e["content"].as_str().unwrap_or("");
                    if let Some(i) = text.find(MARK) {
                        let short: String = text[i + MARK.len()..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
                        if !short.is_empty() {
                            self.attached = Some(short);
                        }
                    }
                }
                Some("continued-in") => {
                    if let Some(id) = e["continuedInSessionId"].as_str() {
                        self.parked = Some(id.to_string());
                    }
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn ev(name: &str, tool: &str) -> Value {
        json!({ "hook_event_name": name, "tool_name": tool, "stop_hook_active": false })
    }

    #[test]
    fn free_time_follows_real_work_once() {
        let mut f = Free::default();
        let blocks = |r: &Value| r["decision"] == "block";
        // a question answered without tools: no free moment
        free_step(&mut f, &ev("UserPromptSubmit", ""), true);
        assert!(!blocks(&free_step(&mut f, &ev("Stop", ""), true).1));
        // real work: the stop becomes a free moment, and its events are the session's own
        free_step(&mut f, &ev("UserPromptSubmit", ""), true);
        free_step(&mut f, &ev("PostToolUse", "Edit"), true);
        let (on_break, reply) = free_step(&mut f, &ev("Stop", ""), true);
        assert!(!on_break && blocks(&reply) && reply["reason"] == FREE_TIME);
        assert!(free_step(&mut f, &ev("PostToolUse", "mcp__garden__build"), true).0);
        let (on_break, reply) = free_step(&mut f, &json!({ "hook_event_name": "Stop", "stop_hook_active": true }), true);
        assert!(on_break && !blocks(&reply));
        // more work soon after: not again until FREE_EVERY has passed
        free_step(&mut f, &ev("UserPromptSubmit", ""), true);
        free_step(&mut f, &ev("PostToolUse", "Bash"), true);
        assert!(!blocks(&free_step(&mut f, &ev("Stop", ""), true).1));
        f.last = Some(std::time::Instant::now() - FREE_EVERY);
        free_step(&mut f, &ev("PostToolUse", "Bash"), true);
        assert!(blocks(&free_step(&mut f, &ev("Stop", ""), true).1));
    }

    #[test]
    fn free_time_needs_the_toggle_and_work_outside_the_garden() {
        let mut f = Free::default();
        free_step(&mut f, &ev("PostToolUse", "mcp__garden__look"), true);
        assert!(free_step(&mut f, &ev("Stop", ""), true).1.get("decision").is_none());
        free_step(&mut f, &ev("PostToolUse", "Read"), false);
        assert!(free_step(&mut f, &ev("Stop", ""), false).1.get("decision").is_none());
    }

    #[test]
    fn resume_into_a_background_job_is_followed() {
        let path = std::env::temp_dir().join(format!("mochi-attach-{}.jsonl", std::process::id()));
        let mut f = std::fs::File::create(&path).unwrap();
        // history from before the garden started reading: an old /resume must not attach
        writeln!(f, r#"{{"type":"system","subtype":"local_command","content":"<local-command-stdout>Opening \"old\", running in the background (deadbeef)</local-command-stdout>"}}"#).unwrap();
        let mut scan = Scan::default();
        scan.read(&path);
        assert_eq!(scan.attached, None);
        // the real lines a Mochi tab wrote when its user resumed a running session
        writeln!(f, r#"{{"type":"system","subtype":"local_command","content":"<command-name>/resume</command-name>"}}"#).unwrap();
        writeln!(f, r#"{{"type":"system","subtype":"local_command","content":"<local-command-stdout>Opening \"Rename the analytics app\", running in the background (88bda10c)</local-command-stdout>"}}"#).unwrap();
        writeln!(f, r#"{{"type":"continued-in","sessionId":"f9391645-ba68-46a7-851c-c0baad592c62","continuedInSessionId":"6808bef8-f7ab-4b9e-80dc-edc9269449b6"}}"#).unwrap();
        drop(f);
        scan.read(&path);
        assert_eq!(scan.attached.as_deref(), Some("88bda10c"));
        assert_eq!(scan.parked.as_deref(), Some("6808bef8-f7ab-4b9e-80dc-edc9269449b6"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_parked_job_is_found_in_the_registry() {
        // the registry when a fresh Mochi tab /resume'd into "Rename the analytics app"
        let reg: Vec<Value> = serde_json::from_str(r#"[
            {"sessionId":"f215e59b-203a-4a8e-a492-b7ef5404b6f0","kind":"bg","name":"f215e59b","jobId":"f215e59b","status":"idle"},
            {"sessionId":"29851d35-56ac-4a6e-9a3f-874e6e782762","kind":"interactive","name":"user-b5","nameSource":"derived","status":"idle","parkedJobId":"f215e59b"},
            {"sessionId":"88bda10c-0000-4000-8000-000000000000","kind":"bg","name":"Rename the analytics app","jobId":"88bda10c","status":"idle"}
        ]"#).unwrap();
        assert_eq!(parked_by(&reg, "f215e59b-203a-4a8e-a492-b7ef5404b6f0").as_deref(), Some("29851d35-56ac-4a6e-9a3f-874e6e782762"));
        assert_eq!(parked_by(&reg, "88bda10c-0000-4000-8000-000000000000"), None);
        assert_eq!(parked_by(&reg, "29851d35-56ac-4a6e-9a3f-874e6e782762"), None);
    }
}
