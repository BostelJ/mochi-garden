// Updates, from two places, installed the same way: the page waits until no mochi is busy, saves
// the garden and says go (apply_update); open sessions come back on their own after the restart.
//  - Releases: the updater plugin checks GitHub now and then for a newer signed release
//    (watch_releases; the endpoint and public key are in tauri.conf.json) and runs its installer.
//  - Local builds: `npm run ship` builds a new Mochi Garden, stages it in <data>/update/ and POSTs
//    its path to /update (with the token from <data>/app.json, so only something that can read
//    the data folder can ask). A small detached helper waits for this process to exit, puts the
//    new build where this one lives, and starts it again.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

pub struct Update {
    pub token: String,
    /// A local build handed over by `npm run ship`.
    pub pending: Mutex<Option<PathBuf>>,
    /// A newer release found by the updater.
    pub release: Mutex<Option<tauri_plugin_updater::Update>>,
}

impl Update {
    pub fn new() -> Self {
        Update { token: uuid::Uuid::new_v4().to_string(), pending: Mutex::new(None), release: Mutex::new(None) }
    }
}

/// Look for a newer release a little after launch and every few hours after that.
pub fn watch_releases(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            let found = match app.updater() {
                Ok(updater) => updater.check().await,
                Err(e) => Err(e),
            };
            match found {
                Ok(Some(update)) => {
                    let version = update.version.clone();
                    *app.state::<Update>().release.lock().unwrap() = Some(update);
                    let _ = app.emit_to("main", "update-ready", json!({ "version": version }));
                }
                Ok(None) => {}
                // offline, or no release to read yet: try again next time
                Err(e) => log(&app, &format!("update check: {e}")),
            }
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

fn log(app: &AppHandle, line: &str) {
    use std::io::Write;
    let path = app.state::<crate::AppState>().data_dir.join("update.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

/// Install a release: download it first (the sessions keep going meanwhile), then end the
/// sessions cleanly, since the installer takes over and this process exits without the usual
/// shutdown, and then run it. It starts the new version, which resumes the sessions.
async fn install_release(app: AppHandle, update: tauri_plugin_updater::Update) {
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(b) => b,
        Err(e) => {
            log(&app, &format!("download {}: {e}", update.version));
            let _ = app.emit_to("main", "update-failed", e.to_string());
            return;
        }
    };
    for (_, mut s) in app.state::<crate::AppState>().ptys.lock().unwrap().drain() {
        crate::pty::kill(&mut s);
    }
    log(&app, &format!("installing {}", update.version));
    if let Err(e) = update.install(bytes) {
        log(&app, &format!("install {}: {e}", update.version));
        let _ = app.emit_to("main", "update-failed", e.to_string());
        return;
    }
    app.restart();
}

/// Where `npm run ship` finds the running app (and, once it has quit, what it should replace).
pub fn write_info(data_dir: &Path, port: u16, token: &str) {
    let info = json!({
        "port": port,
        "token": token,
        "pid": std::process::id(),
        "install": install_target().map(|p| p.to_string_lossy().into_owned()),
    });
    let _ = std::fs::write(data_dir.join("app.json"), serde_json::to_string_pretty(&info).unwrap());
}

/// What an update replaces: this exe on Windows, the enclosing .app bundle on a Mac.
fn install_target() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    if cfg!(target_os = "macos") {
        // .../Mochi Garden.app/Contents/MacOS/mochi-garden
        if let Some(app) = exe.ancestors().nth(3) {
            if app.extension().is_some_and(|e| e == "app") {
                return Some(app.to_path_buf());
            }
        }
    }
    Some(exe)
}

#[derive(Deserialize)]
pub struct Request {
    token: String,
    path: String,
}

pub async fn post(State(app): State<AppHandle>, Json(req): Json<Request>) -> (StatusCode, Json<Value>) {
    let up = app.state::<Update>();
    if req.token != up.token {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "bad token" })));
    }
    let path = PathBuf::from(&req.path);
    if !path.exists() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "no such build" })));
    }
    *up.pending.lock().unwrap() = Some(path);
    let _ = app.emit_to("main", "update-ready", ());
    (StatusCode::OK, Json(json!({ "ok": true })))
}

/// The page's go-ahead (it has saved the garden and no mochi is busy): hand over to the helper
/// and quit. `hidden` relaunches straight to the tray, as the window was.
#[tauri::command]
pub fn apply_update(app: AppHandle, hidden: bool) -> Result<(), String> {
    let local = app.state::<Update>().pending.lock().unwrap().clone();
    let Some(new) = local else {
        let release = app.state::<Update>().release.lock().unwrap().take().ok_or("no update waiting")?;
        tauri::async_runtime::spawn(install_release(app.clone(), release));
        return Ok(());
    };
    let target = install_target().ok_or("can't tell where Mochi Garden is installed")?;
    let log = app.state::<crate::AppState>().data_dir.join("update.log");
    spawn_helper(&new, &target, hidden, &log)?;
    app.exit(0);
    Ok(())
}

#[cfg(windows)]
fn spawn_helper(new: &Path, target: &Path, hidden: bool, log: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let q = |p: &Path| format!("'{}'", p.to_string_lossy().replace('\'', "''"));
    let args = if hidden { "-ArgumentList '--hidden'" } else { "" };
    // The exe stays locked for a moment after the process ends, so the copy retries.
    let script = format!(
        "$log = {log}; \"$(Get-Date -Format s) waiting for {pid}\" | Out-File $log; \
         Wait-Process -Id {pid} -ErrorAction SilentlyContinue; \
         $ok = $false; for ($i = 0; $i -lt 50; $i++) {{ try {{ Copy-Item -LiteralPath {new} -Destination {target} -Force -ErrorAction Stop; $ok = $true; break }} catch {{ $err = $_; Start-Sleep -Milliseconds 200 }} }}; \
         \"$(Get-Date -Format s) copied: $ok $err\" | Out-File $log -Append; \
         Start-Process -FilePath {target} {args}; \"$(Get-Date -Format s) started\" | Out-File $log -Append",
        pid = std::process::id(),
        new = q(new),
        target = q(target),
        log = q(log),
    );
    let spawn = |flags: u32| {
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(flags)
            .spawn()
    };
    // Out of any job the app runs in, so the helper outlives it; not every job allows that.
    spawn(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB)
        .or_else(|_| spawn(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn spawn_helper(new: &Path, target: &Path, hidden: bool, log: &Path) -> Result<(), String> {
    // $1 pid, $2 new build, $3 what it replaces (a .app bundle or a bare binary), $4 launch
    // args, $5 log file.
    let script = r#"
        echo "$(date) waiting for $1" > "$5"
        while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
        rm -rf "$3.old"
        if mv "$3" "$3.old" && cp -R "$2" "$3"; then rm -rf "$3.old"; echo "$(date) copied" >> "$5"
        else rm -rf "$3"; mv "$3.old" "$3"; echo "$(date) copy failed, kept the old one" >> "$5"; fi
        case "$3" in
            *.app) open "$3" --args $4 ;;
            *) nohup "$3" $4 >/dev/null 2>&1 & ;;
        esac
    "#;
    std::process::Command::new("/bin/sh")
        .args(["-c", script, "sh"])
        .arg(std::process::id().to_string())
        .arg(new)
        .arg(target)
        .arg(if hidden { "--hidden" } else { "" })
        .arg(log)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Launched by the helper with --hidden when the garden was tucked away in the tray.
pub fn start_hidden(app: &AppHandle) {
    if std::env::args().any(|a| a == "--hidden") {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }
    }
}

/// Builds staged for earlier updates are spent once the app has started again.
pub fn clear_staged(data_dir: &Path) {
    let _ = std::fs::remove_dir_all(data_dir.join("update"));
}
