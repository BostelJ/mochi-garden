// Mochi Garden: real Claude Code sessions in terminals beside a pixel garden.
// Each session runs claude in a pseudo-terminal with a per-tab --settings file whose
// HTTP hooks POST every event back to this app (hooks.rs), which forwards them to the UI.

mod hooks;
mod mcp;
mod overlay;
mod pty;
mod update;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, Manager, RunEvent, State, WindowEvent};

pub struct AppState {
    pub ptys: pty::Ptys,
    pub hook_port: Mutex<u16>,
    pub data_dir: PathBuf,
    pub scans: Mutex<HashMap<String, hooks::Scan>>,
    /// Live tab -> its session transcript, learned from hook events; polled for tokens.
    pub transcripts: Mutex<HashMap<String, String>>,
    /// Tab -> sessions it set aside when /resume attached it to a background job. Their hooks and
    /// status line still point at the tab, but the tab isn't showing them, so they're ignored.
    pub parked: Mutex<HashMap<String, std::collections::HashSet<String>>>,
    /// "<tab>/<session>" pairs already checked against the registry for parking (hooks::check_parked).
    pub checked: Mutex<std::collections::HashSet<String>>,
}

#[derive(Serialize)]
struct Started {
    session_id: Option<String>,
}

/// Start (or resume) a Claude Code session in a new terminal tab.
// (async, like watch_session: they search every project folder for a transcript, which must
// not hold up the main thread)
#[tauri::command]
async fn start_session(app: tauri::AppHandle, tab: String, resume: Option<String>, cwd: Option<String>, cols: u16, rows: u16) -> Result<Started, String> {
    tauri::async_runtime::spawn_blocking(move || start_session_blocking(app, tab, resume, cwd, cols, rows))
        .await
        .map_err(|e| e.to_string())?
}

fn start_session_blocking(app: tauri::AppHandle, tab: String, resume: Option<String>, cwd: Option<String>, cols: u16, rows: u16) -> Result<Started, String> {
    let state = app.state::<AppState>();
    let port = *state.hook_port.lock().unwrap();
    let settings = hooks::write_settings(&state.data_dir, &tab, port)?;
    let mcp = mcp::write_config(&state.data_dir, &tab, port)?;
    let mut args = Vec::new();
    // A session that never got a message has no transcript, and `--resume` on it just errors
    // ("No conversation found"), e.g. a tab nobody typed in, or a job parked by /resume
    // (hooks::follow_attach). Start that tab fresh instead.
    let resume = resume.filter(|id| hooks::find_transcript(id).is_some());
    let session_id = match resume {
        Some(id) => {
            args.extend(["--resume".to_string(), id.clone()]);
            Some(id)
        }
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            args.extend(["--session-id".to_string(), id.clone()]);
            Some(id)
        }
    };
    args.extend(["--settings".to_string(), settings.to_string_lossy().into_owned()]);
    // the garden's own tools (mcp.rs)
    args.extend(["--mcp-config".to_string(), mcp.to_string_lossy().into_owned()]);
    let dir = cwd.map(PathBuf::from).unwrap_or_else(|| dirs::home_dir().unwrap_or_default());
    let session = pty::spawn(&app, &tab, args, &dir, cols, rows)?;
    state.ptys.lock().unwrap().insert(tab, session);
    Ok(Started { session_id })
}

/// Follow a session the tab is showing but whose hooks we can't hear: poll its transcript.
#[tauri::command]
async fn watch_session(app: tauri::AppHandle, tab: String, session_id: String, transcript: Option<String>) -> bool {
    tauri::async_runtime::spawn_blocking(move || watch_session_blocking(app, tab, session_id, transcript)).await.unwrap_or(false)
}

fn watch_session_blocking(app: tauri::AppHandle, tab: String, session_id: String, transcript: Option<String>) -> bool {
    let state = app.state::<AppState>();
    let path = transcript.filter(|t| std::path::Path::new(t).is_file()).map(PathBuf::from).or_else(|| hooks::find_transcript(&session_id));
    match path {
        Some(p) => {
            state.transcripts.lock().unwrap().insert(tab, p.to_string_lossy().into_owned());
            true
        }
        None => false,
    }
}

#[tauri::command]
fn pty_write(state: State<AppState>, tab: String, data: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    let s = ptys.get_mut(&tab).ok_or("no such tab")?;
    pty::write(s, data.as_bytes())
}

#[tauri::command]
fn pty_resize(state: State<AppState>, tab: String, cols: u16, rows: u16) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    let s = ptys.get(&tab).ok_or("no such tab")?;
    pty::resize(s, cols, rows)
}

#[tauri::command]
fn pty_kill(state: State<AppState>, tab: String) {
    if let Some(mut s) = state.ptys.lock().unwrap().remove(&tab) {
        pty::kill(&mut s);
    }
    state.transcripts.lock().unwrap().remove(&tab);
}

#[tauri::command]
fn load_garden(state: State<AppState>) -> String {
    std::fs::read_to_string(state.data_dir.join("garden.json")).unwrap_or_else(|_| "{}".into())
}

#[tauri::command]
fn save_garden(state: State<AppState>, json: String) -> Result<(), String> {
    let tmp = state.data_dir.join("garden.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, state.data_dir.join("garden.json")).map_err(|e| e.to_string())
}

/// Open a web link in the default browser (only http/https).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("not a web link".into());
    }
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    } else {
        std::process::Command::new("open")
    };
    cmd.arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Closing the window asks the page first (sessions may be running); these are its answers.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn hide_main(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    overlay::main_visibility(&app);
}

/// Dev switches for automated runs: MOCHI_AUTOSTART=1 opens a session on launch and
/// MOCHI_TEST_PROMPT types a prompt into it.
#[tauri::command]
fn dev_env() -> serde_json::Value {
    serde_json::json!({
        "autostart": std::env::var("MOCHI_AUTOSTART").is_ok(),
        "prompt": std::env::var("MOCHI_TEST_PROMPT").ok(),
        "cwd": std::env::var("MOCHI_TEST_CWD").ok(),
        "demo": std::env::var("MOCHI_DEMO").is_ok(),
        "demo_only": std::env::var("MOCHI_DEMO_ONLY").ok(),
    })
}

pub fn run() {
    pty::fix_mac_env();
    let context = tauri::generate_context!();
    // MOCHI_DATA_DIR points test runs at a scratch garden, never the real one; a build with
    // another identifier (a test install of the release flow) keeps its own folder too.
    let folder = match context.config().identifier.as_str() {
        "com.mochigarden.app" => "MochiGarden".to_string(),
        other => other.to_string(),
    };
    let data_dir = std::env::var_os("MOCHI_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::data_dir().unwrap_or_default().join(folder));
    std::fs::create_dir_all(data_dir.join("hooks")).ok();
    update::clear_staged(&data_dir);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            ptys: Mutex::new(HashMap::new()),
            hook_port: Mutex::new(0),
            data_dir,
            scans: Mutex::new(HashMap::new()),
            transcripts: Mutex::new(HashMap::new()),
            parked: Mutex::new(HashMap::new()),
            checked: Mutex::new(Default::default()),
        })
        .manage(update::Update::new())
        .manage(mcp::Calls::default())
        .setup(|app| {
            let handle = app.handle().clone();
            hooks::poll_transcripts(handle.clone());
            let port = tauri::async_runtime::block_on(hooks::serve(handle));
            *app.state::<AppState>().hook_port.lock().unwrap() = port;
            update::write_info(&app.state::<AppState>().data_dir, port, &app.state::<update::Update>().token);
            update::start_hidden(app.handle());
            update::watch_releases(app.handle().clone());
            if let Err(e) = overlay::setup(app.handle()) {
                eprintln!("tray overlay unavailable: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_session,
            watch_session,
            pty_write,
            pty_resize,
            pty_kill,
            load_garden,
            save_garden,
            dev_env,
            open_url,
            quit_app,
            hide_main,
            overlay::taskbar_state,
            overlay::overlay_hits,
            overlay::overlay_open,
            update::apply_update,
            mcp::garden_reply
        ])
        .build(context)
        .expect("error while building Mochi Garden");

    app.run(|app, event| match event {
        // The overlay is a second window; closing the main one asks the page what to do
        // (keep running in the tray, or quit), since sessions may be open.
        RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { api, .. }, .. } if label == "main" => {
            api.prevent_close();
            let _ = app.emit_to("main", "close-requested", ());
        }
        RunEvent::WindowEvent { label, event: WindowEvent::Focused(f), .. } if label == "main" => overlay::main_focus(app, f),
        RunEvent::WindowEvent { label, event: WindowEvent::Resized(_), .. } if label == "main" => overlay::main_visibility(app),
        // Cmd+Q on a Mac asks first too (quit_app and updates exit with a code, so they pass).
        RunEvent::ExitRequested { code: None, api, .. } => {
            api.prevent_exit();
            let _ = app.emit_to("main", "close-requested", ());
        }
        // Clicking the Dock icon brings a garden that was tucked away back.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        RunEvent::Exit => {
            let state = app.state::<AppState>();
            for (_, mut s) in state.ptys.lock().unwrap().drain() {
                pty::kill(&mut s);
            }
        }
        _ => {}
    });
}
