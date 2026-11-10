// Updates, from two places, installed the same way: the page waits until no mochi is busy, saves
// the garden and says go (apply_update); open sessions come back on their own after the restart.
//  - Releases: the updater plugin checks GitHub now and then for a newer signed release
//    (watch_releases; the endpoint and public key are in tauri.conf.json) and runs its installer.
//  - Local builds: `npm run ship` builds a new Mochi Garden, stages it in <data>/update/ and POSTs
//    its path to /update (with the token from <data>/app.json, so only something that can read
//    the data folder can ask). A small detached helper waits for this process to exit, puts the
//    new build where this one lives, and starts it again.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

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
    /// A release is installing. It isn't looked for, offered or started again meanwhile: a second
    /// install over the first left the app half signed, and macOS wouldn't open it.
    pub installing: AtomicBool,
}

impl Update {
    pub fn new() -> Self {
        Update {
            token: uuid::Uuid::new_v4().to_string(),
            pending: Mutex::new(None),
            release: Mutex::new(None),
            installing: AtomicBool::new(false),
        }
    }
}

/// Look for a newer release a little after launch and every few hours after that.
pub fn watch_releases(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            let found = match app.updater() {
                _ if app.state::<Update>().installing.load(Ordering::SeqCst) => Ok(None),
                Ok(updater) => updater.check().await,
                Err(e) => Err(e),
            };
            match found {
                // an install began while this check was out
                Ok(Some(_)) if app.state::<Update>().installing.load(Ordering::SeqCst) => {}
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
            app.state::<Update>().installing.store(false, Ordering::SeqCst);
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
        app.state::<Update>().installing.store(false, Ordering::SeqCst);
        let _ = app.emit_to("main", "update-failed", e.to_string());
        return;
    }
    keep_identity(&app);
    app.restart();
}

/// The name of the certificate `tools/mac-signing-cert.sh` makes and `npm run ship` signs with.
const LOCAL_IDENTITY: &str = "Mochi Garden Local";

/// macOS ties Screen Recording (and the other privacy grants) to the app's signature. Releases are
/// signed ad hoc, a new identity every build, so each one would ask again; on a Mac with the local
/// certificate a release is signed again with it, so every install, release or `npm run ship`, is
/// the same app to macOS and the grant sticks. Without the certificate this does nothing.
fn keep_identity(app: &AppHandle) {
    if !cfg!(target_os = "macos") {
        return;
    }
    let Some(bundle) = install_target().filter(|p| p.extension().is_some_and(|e| e == "app")) else { return };
    match sign_with(&bundle, LOCAL_IDENTITY) {
        Ok(()) => log(app, &format!("signed {} with {LOCAL_IDENTITY}", bundle.display())),
        Err(e) => log(app, &format!("kept the release's own signature: {e}")),
    }
}

/// How long codesign may take. It asks for the keychain key in a dialog until "Always Allow" is
/// chosen, and with nobody there it would wait for good, sessions already ended.
const SIGN_LIMIT: Duration = Duration::from_secs(60);

/// Sign the bundle with a certificate from the keychain. A copy beside it is signed and takes
/// its place only once it verifies, so whatever goes wrong (no certificate, a dialog nobody
/// answers, codesign stopped halfway) the installed app is left as it was and still opens.
fn sign_with(bundle: &Path, identity: &str) -> Result<(), String> {
    let run = |program: &str, args: &[&std::ffi::OsStr]| {
        run_within(std::process::Command::new(program).args(args), SIGN_LIMIT).map_err(|e| format!("{program}: {e}"))
    };
    run("/usr/bin/security", &["find-certificate".as_ref(), "-c".as_ref(), identity.as_ref()])
        .map_err(|_| format!("no {identity} certificate"))?;
    let name = bundle.file_name().ok_or("no bundle name")?.to_string_lossy();
    // dot names without .app: not a second Mochi Garden to Finder or Spotlight
    let staged = bundle.with_file_name(format!(".{name}.signing"));
    let old = bundle.with_file_name(format!(".{name}.unsigned"));
    let _ = std::fs::remove_dir_all(&staged);
    let _ = std::fs::remove_dir_all(&old);
    let signed = (|| {
        run("/bin/cp", &["-R".as_ref(), bundle.as_os_str(), staged.as_os_str()])?;
        run("/usr/bin/codesign", &["--force".as_ref(), "--deep".as_ref(), "--sign".as_ref(), identity.as_ref(), staged.as_os_str()])?;
        run("/usr/bin/codesign", &["--verify".as_ref(), "--deep".as_ref(), "--strict".as_ref(), staged.as_os_str()])?;
        std::fs::rename(bundle, &old).map_err(|e| e.to_string())?;
        if let Err(e) = std::fs::rename(&staged, bundle) {
            let _ = std::fs::rename(&old, bundle);
            return Err(e.to_string());
        }
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&staged);
    let _ = std::fs::remove_dir_all(&old);
    signed
}

/// Run a command to its end, or stop it at the limit. Err carries what it wrote to stderr.
fn run_within(command: &mut std::process::Command, limit: Duration) -> Result<(), String> {
    use std::io::Read;
    use std::process::Stdio;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                let mut err = String::new();
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut err);
                }
                let err = err.trim();
                return Err(if err.is_empty() { status.to_string() } else { err.to_string() });
            }
            Ok(None) if started.elapsed() >= limit => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("no answer in {} seconds", limit.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(e.to_string()),
        }
    }
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
        let up = app.state::<Update>();
        let release = up.release.lock().unwrap().take().ok_or("no update waiting")?;
        if !up.installing.swap(true, Ordering::SeqCst) {
            tauri::async_runtime::spawn(install_release(app.clone(), release));
        }
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// A stand-in bundle: a real program under Contents/MacOS, so codesign has something to sign.
    fn bundle(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mochi-sign-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let app = root.join("Mochi Test.app");
        std::fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        std::fs::copy("/bin/ls", app.join("Contents/MacOS/mochi-test")).unwrap();
        let plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>mochi-test</string>
<key>CFBundleIdentifier</key><string>com.mochigarden.test</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>"#;
        std::fs::write(app.join("Contents/Info.plist"), plist).unwrap();
        app
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    #[test]
    fn a_command_that_never_ends_is_stopped() {
        let started = Instant::now();
        let out = run_within(std::process::Command::new("/bin/sleep").arg("30"), Duration::from_millis(300));
        assert_eq!(out.unwrap_err(), "no answer in 0 seconds");
        assert!(started.elapsed() < Duration::from_secs(5));
        let out = run_within(std::process::Command::new("/bin/ls").arg("/no/such/folder"), Duration::from_secs(5));
        assert!(out.unwrap_err().contains("No such file"));
    }

    #[test]
    fn without_the_certificate_the_app_is_left_alone() {
        let app = bundle("none");
        let exe = app.join("Contents/MacOS/mochi-test");
        let before = std::fs::read(&exe).unwrap();
        let out = sign_with(&app, "Mochi Garden No Such Certificate");
        assert_eq!(out.unwrap_err(), "no Mochi Garden No Such Certificate certificate");
        assert!(std::fs::read(&exe).unwrap() == before);
        assert_eq!(names(app.parent().unwrap()), ["Mochi Test.app"]);
        let _ = std::fs::remove_dir_all(app.parent().unwrap());
    }

    /// Needs the certificate from tools/mac-signing-cert.sh, and may ask for the keychain key:
    /// `cargo test --lib --manifest-path src-tauri/Cargo.toml -- --ignored`
    #[test]
    #[ignore]
    fn the_local_certificate_signs_every_architecture() {
        let app = bundle("local");
        sign_with(&app, LOCAL_IDENTITY).unwrap();
        assert_eq!(names(app.parent().unwrap()), ["Mochi Test.app"]);
        for arch in ["arm64", "x86_64"] {
            let exe = app.join("Contents/MacOS/mochi-test");
            let check = std::process::Command::new("/usr/bin/codesign").args(["--verify", "--strict", "--arch", arch]).arg(&exe).output().unwrap();
            assert!(check.status.success(), "{arch}: {}", String::from_utf8_lossy(&check.stderr));
            let shown = std::process::Command::new("/usr/bin/codesign").args(["-dvv", "--arch", arch]).arg(&exe).output().unwrap();
            assert!(String::from_utf8_lossy(&shown.stderr).contains("Authority=Mochi Garden Local"), "{arch}");
        }
        let _ = std::fs::remove_dir_all(app.parent().unwrap());
    }
}
