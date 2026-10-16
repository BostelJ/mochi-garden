// Pseudo-terminals running claude; output streams to the UI as base64 "pty-data" events.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub struct Session {
    master: Box<dyn MasterPty + Send>,
    /// Keystrokes for the terminal, written in order by its own thread: a busy claude that isn't
    /// reading its input can fill the pipe, and the write must not hold up the app's main thread.
    input: std::sync::mpsc::Sender<Vec<u8>>,
    child: Box<dyn Child + Send + Sync>,
}

pub type Ptys = Mutex<HashMap<String, Session>>;

#[derive(Serialize, Clone)]
struct PtyData {
    tab: String,
    data: String,
}

/// claude from PATH, then the native installer's ~/.local/bin, else plain "claude".
fn claude_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    dirs.extend([home.join(".local/bin"), home.join(".claude/local"), "/opt/homebrew/bin".into(), "/usr/local/bin".into()]);
    for dir in dirs {
        for name in ["claude.exe", "claude.cmd", "claude"] {
            let p = dir.join(name);
            if p.is_file() {
                return p;
            }
        }
    }
    PathBuf::from("claude")
}

/// An app opened from Finder or the Dock gets launchd's bare environment (PATH is just
/// /usr/bin:/bin:/usr/sbin:/sbin, no LANG), so claude and the tools it runs (git, node, gh...)
/// wouldn't be found. Borrow the PATH the user's login shell sets up, once, at startup.
pub fn fix_mac_env() {
    if !cfg!(target_os = "macos") {
        return;
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = std::process::Command::new(&shell)
        .args(["-ilc", "printf '\\n__PATH__%s' \"$PATH\""])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output();
    if let Ok(out) = out {
        let text = String::from_utf8_lossy(&out.stdout);
        if let Some(path) = text.rsplit("__PATH__").next().filter(|_| text.contains("__PATH__")) {
            let path = path.trim();
            if !path.is_empty() {
                std::env::set_var("PATH", path);
            }
        }
    }
    if std::env::var_os("LANG").is_none() {
        std::env::set_var("LANG", "en_US.UTF-8");
    }
}

pub fn spawn(app: &AppHandle, tab: &str, args: Vec<String>, cwd: &Path, cols: u16, rows: u16) -> Result<Session, String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(claude_path());
    cmd.args(args);
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // The terminal panel shows colour, so a NO_COLOR inherited by the app (from whatever started
    // it, e.g. an agent's shell) must not turn it off for every session.
    cmd.env_remove("NO_COLOR");
    // When the app itself was started from inside a Claude Code session, don't let its
    // session identity leak in: the child would think it is a sub-session and stop saving
    // its transcript (which is where token counts and titles come from).
    for (key, _) in std::env::vars_os() {
        let k = key.to_string_lossy();
        if k == "CLAUDECODE" || k == "CLAUDE_PID" || k == "CLAUDE_EFFORT"
            || (k.starts_with("CLAUDE_CODE_") && k != "CLAUDE_CODE_PLUGIN_DIRS")
        {
            cmd.env_remove(&key);
        }
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let (input, keys) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        for bytes in keys {
            if writer.write_all(&bytes).and_then(|_| writer.flush()).is_err() {
                break;
            }
        }
    });
    let app = app.clone();
    let tab = tab.to_string();
    std::thread::spawn(move || {
        let b64 = base64::engine::general_purpose::STANDARD;
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app.emit("pty-data", PtyData { tab: tab.clone(), data: b64.encode(&buf[..n]) });
                }
            }
        }
        let _ = app.emit("pty-exit", tab);
    });
    Ok(Session { master: pair.master, input, child })
}

pub fn write(s: &mut Session, bytes: &[u8]) -> Result<(), String> {
    s.input.send(bytes.to_vec()).map_err(|_| "the terminal has closed".to_string())
}

pub fn resize(s: &Session, cols: u16, rows: u16) -> Result<(), String> {
    s.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

pub fn kill(s: &mut Session) {
    let _ = s.child.kill();
}
