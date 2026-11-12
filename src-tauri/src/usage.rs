// The account's usage beyond what each tab's status line carries, and a record of every day's tokens.
//
// - Live limits: every few minutes a headless `claude` answers a `get_usage` control request (no
//   model call, no tokens): the plan's limits as the server sends them right now, including
//   per-model weekly windows such as Fable's, which the status line leaves out. Claude Code also
//   keeps whether the account holds an unused limit reset in ~/.claude.json
//   (unusedLimitResetStatusCache, re-checked at most every three days); that goes along as `reset`.
//   Emitted as "usage-live".
// - Days: every transcript under ~/.claude/projects is tallied per UTC hour and model family and
//   remembered in usage-days.json in the data folder, so the record outlives Claude Code deleting
//   old transcripts. Emitted as "days"; the page draws the calendar in local days (calendar.js).

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

const LIVE_EVERY: Duration = Duration::from_secs(180);
const DAYS_EVERY: Duration = Duration::from_secs(300);

/// The last live answer, for a page that (re)loads and for the tabs' status line text.
static LIVE: Mutex<Option<Value>> = Mutex::new(None);
/// Every hour's tokens by model family, summed over all transcripts ever seen.
static HOURS: Mutex<Option<Value>> = Mutex::new(None);

pub fn start(app: AppHandle) {
    let a = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        loop {
            let dir = a.state::<AppState>().data_dir.clone();
            if let Some(v) = live(&dir) {
                *LIVE.lock().unwrap() = Some(v.clone());
                let _ = a.emit("usage-live", v);
            }
            std::thread::sleep(LIVE_EVERY);
        }
    });
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(8));
        let dir = app.state::<AppState>().data_dir.clone();
        let file = dir.join("usage-days.json");
        let mut days: Days = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        loop {
            if let Some(projects) = dirs::home_dir().map(|h| h.join(".claude").join("projects")) {
                if days.refresh(&projects) {
                    let tmp = dir.join("usage-days.json.tmp");
                    if std::fs::write(&tmp, serde_json::to_string(&days).unwrap_or_default()).is_ok() {
                        let _ = std::fs::rename(&tmp, &file);
                    }
                }
            }
            let hours = days.hours();
            *HOURS.lock().unwrap() = Some(hours.clone());
            let _ = app.emit("days", hours);
            std::thread::sleep(DAYS_EVERY);
        }
    });
}

#[tauri::command]
pub fn usage_live() -> Option<Value> {
    LIVE.lock().unwrap().clone()
}

#[tauri::command]
pub fn usage_days() -> Option<Value> {
    HOURS.lock().unwrap().clone()
}

/// The per-model weekly windows for a tab's status line: " · fable 3% left".
pub fn models_line() -> String {
    let live = LIVE.lock().unwrap();
    let Some(models) = live.as_ref().and_then(|v| v["rate_limits"]["model_scoped"].as_array().cloned()) else { return String::new() };
    models
        .iter()
        .filter_map(|m| {
            let name = m["display_name"].as_str()?.to_lowercase();
            let used = m["utilization"].as_f64()?;
            Some(format!(" · {name} {:.0}% left", (100.0 - used).max(0.0)))
        })
        .collect()
}

fn live(cwd: &Path) -> Option<Value> {
    let answer = ask_usage(cwd)?;
    if answer["rate_limits_available"] == false {
        return None;
    }
    let r = &answer["rate_limits"];
    let pick = |k: &str| r.get(k).cloned().unwrap_or(Value::Null);
    let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    Some(json!({
        "at": at,
        "rate_limits": { "five_hour": pick("five_hour"), "seven_day": pick("seven_day"), "model_scoped": pick("model_scoped") },
        "reset": unused_reset(),
    }))
}

/// One `get_usage` answer from a headless claude: print mode taking control requests on stdin,
/// with no settings (so no hooks or plugins), no MCP servers and no transcript.
fn ask_usage(cwd: &Path) -> Option<Value> {
    let mut cmd = Command::new(crate::pty::claude_path());
    cmd.args([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--setting-sources",
        "",
    ])
    .current_dir(cwd)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().ok()?;
    let mut stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;
    // Read on a thread of its own, so a claude that never answers can be given up on.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if v["type"] == "control_response" && v["response"]["request_id"] == "usage" {
                let _ = tx.send(v["response"].clone());
                return;
            }
        }
    });
    let ask = concat!(
        r#"{"type":"control_request","request_id":"init","request":{"subtype":"initialize"}}"#,
        "\n",
        r#"{"type":"control_request","request_id":"usage","request":{"subtype":"get_usage","skip_behaviors":true}}"#,
        "\n"
    );
    let _ = stdin.write_all(ask.as_bytes());
    let _ = stdin.flush();
    let got = rx.recv_timeout(Duration::from_secs(30)).ok();
    // Closing its input ends a print-mode session; one still running a moment later is stopped.
    drop(stdin);
    for _ in 0..30 {
        if matches!(child.try_wait(), Ok(Some(_))) {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if !matches!(child.try_wait(), Ok(Some(_))) {
        let _ = child.kill();
        let _ = child.wait();
    }
    let r = got?;
    (r["subtype"] == "success").then(|| r["response"].clone())
}

/// Whether the account holds an unused limit reset, as Claude Code last checked (it only stores
/// yes or no, not how many). The page decides whether the check is still fresh enough to show.
fn unused_reset() -> Value {
    let Some(path) = dirs::home_dir().map(|h| h.join(".claude.json")) else { return Value::Null };
    let Ok(text) = std::fs::read_to_string(path) else { return Value::Null };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return Value::Null };
    let c = &v["unusedLimitResetStatusCache"];
    if !c.is_object() {
        return Value::Null;
    }
    json!({ "held": c["holdsUnusedReset"], "checkedAt": c["checkedAt"], "validUntil": c["validUntil"] })
}

// The day record ------------------------------------------------------------------------------

/// Every transcript's tally, kept after the transcript itself is deleted.
#[derive(Serialize, Deserialize, Default)]
pub struct Days {
    files: BTreeMap<String, Tally>,
}

/// One transcript: how far it has been read and its tokens per UTC hour ("2026-11-11T19") and
/// model family. tokens = input + cache writes + output, like the garden's own count (hooks::Scan).
#[derive(Serialize, Deserialize, Default)]
struct Tally {
    read: u64,
    hours: BTreeMap<String, BTreeMap<String, u64>>,
    /// The last few message ids counted: a message's lines repeat back to back while it streams,
    /// each with its usage so far, so a repeat replaces what was counted for it.
    #[serde(default)]
    recent: Vec<(String, String, String, u64)>,
}

impl Days {
    /// Read whatever the transcripts gained since last time. True if anything changed.
    pub fn refresh(&mut self, projects: &Path) -> bool {
        let mut changed = false;
        for path in transcripts(projects) {
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            let key = path.to_string_lossy().into_owned();
            let t = self.files.entry(key).or_default();
            if meta.len() < t.read {
                *t = Tally::default(); // rewritten: read it again from the start
            }
            if meta.len() > t.read {
                changed |= t.read_from(&path);
            }
        }
        changed
    }

    /// Every hour's tokens by family, summed over all transcripts.
    pub fn hours(&self) -> Value {
        let mut all: BTreeMap<&str, BTreeMap<&str, u64>> = BTreeMap::new();
        for t in self.files.values() {
            for (hour, fams) in &t.hours {
                let h = all.entry(hour).or_default();
                for (fam, n) in fams {
                    *h.entry(fam).or_default() += n;
                }
            }
        }
        serde_json::to_value(all).unwrap_or(Value::Null)
    }
}

impl Tally {
    fn read_from(&mut self, path: &Path) -> bool {
        let Ok(mut f) = std::fs::File::open(path) else { return false };
        if f.seek(SeekFrom::Start(self.read)).is_err() {
            return false;
        }
        let mut r = BufReader::with_capacity(1 << 16, &mut f);
        let mut line = Vec::new();
        let mut changed = false;
        loop {
            line.clear();
            let Ok(n) = r.read_until(b'\n', &mut line) else { break };
            // only whole lines: one still being written is read next time
            if n == 0 || line.last() != Some(&b'\n') {
                break;
            }
            self.read += n as u64;
            changed |= self.count(&line);
        }
        changed
    }

    fn count(&mut self, line: &[u8]) -> bool {
        // Most of a transcript is tool output: skip anything that can't be a reply before parsing.
        let Ok(text) = std::str::from_utf8(line) else { return false };
        if !text.contains("\"assistant\"") || !text.contains("\"usage\"") {
            return false;
        }
        let Ok(e) = serde_json::from_str::<Value>(text) else { return false };
        if e["type"] != "assistant" {
            return false;
        }
        let m = &e["message"];
        let model = m["model"].as_str().unwrap_or("");
        let id = m["id"].as_str().unwrap_or("");
        let ts = e["timestamp"].as_str().unwrap_or("");
        if model.starts_with('<') || id.is_empty() || ts.len() < 13 {
            return false;
        }
        let u = &m["usage"];
        let n: u64 = ["input_tokens", "cache_creation_input_tokens", "output_tokens"].iter().map(|k| u[*k].as_u64().unwrap_or(0)).sum();
        let hour = ts[..13].to_string();
        let fam = family(model).to_string();
        if let Some(i) = self.recent.iter().position(|r| r.0 == id) {
            let (_, h, f, before) = self.recent.remove(i);
            if let Some(v) = self.hours.get_mut(&h).and_then(|x| x.get_mut(&f)) {
                *v = v.saturating_sub(before);
            }
        }
        *self.hours.entry(hour.clone()).or_default().entry(fam.clone()).or_default() += n;
        self.recent.push((id.to_string(), hour, fam, n));
        if self.recent.len() > 8 {
            self.recent.remove(0);
        }
        true
    }
}

fn family(model: &str) -> &'static str {
    ["fable", "mythos", "opus", "sonnet", "haiku"].into_iter().find(|f| model.contains(f)).unwrap_or("other")
}

/// Every .jsonl under the projects folder: sessions, and their subagents a few levels down.
fn transcripts(projects: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for e in entries.flatten() {
            let p = e.path();
            match e.file_type() {
                Ok(t) if t.is_dir() && depth < 4 => walk(&p, depth + 1, out),
                Ok(t) if t.is_file() && p.extension().is_some_and(|x| x == "jsonl") => out.push(p),
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    walk(projects, 0, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(id: &str, model: &str, ts: &str, input: u64, output: u64) -> String {
        json!({ "type": "assistant", "timestamp": ts, "message": { "id": id, "model": model, "usage": { "input_tokens": input, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 999, "output_tokens": output } } })
            .to_string()
            + "\n"
    }

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mochi-days-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("proj").join("sess").join("subagents")).unwrap();
        d
    }

    #[test]
    fn hours_add_up_by_family_with_streamed_repeats_counted_once() {
        let d = dir("tally");
        let main = d.join("proj").join("a.jsonl");
        let text = reply("m1", "claude-fable-5-2", "2026-11-11T19:05:00Z", 100, 10)
            + &reply("m1", "claude-fable-5-2", "2026-11-11T19:05:01Z", 100, 50) // the same reply, streamed further
            + r#"{"type":"user","message":{"content":"a tool result mentioning \"assistant\" and \"usage\""}}"#
            + "\n"
            + &reply("m2", "claude-opus-5-5", "2026-11-11T20:00:00Z", 5, 5)
            + &reply("m3", "<synthetic>", "2026-11-11T20:00:00Z", 5, 5);
        std::fs::write(&main, text).unwrap();
        std::fs::write(d.join("proj").join("sess").join("subagents").join("agent-x.jsonl"), reply("s1", "claude-haiku-5-5", "2026-11-11T19:30:00Z", 7, 0)).unwrap();
        let mut days = Days::default();
        assert!(days.refresh(&d));
        let h = days.hours();
        assert_eq!(h["2026-11-11T19"]["fable"], 150);
        assert_eq!(h["2026-11-11T19"]["haiku"], 7);
        assert_eq!(h["2026-11-11T20"]["opus"], 10);
        assert!(h["2026-11-11T20"].get("other").is_none());
        // nothing new: nothing changes
        assert!(!days.refresh(&d));
    }

    #[test]
    fn a_growing_transcript_is_read_on_from_where_it_stopped_and_a_deleted_one_is_remembered() {
        let d = dir("grow");
        let main = d.join("proj").join("a.jsonl");
        // a half-written line is left for next time
        std::fs::write(&main, reply("m1", "claude-opus-5-5", "2026-11-10T08:00:00Z", 10, 0) + "{\"type\":\"assis").unwrap();
        let mut days = Days::default();
        days.refresh(&d);
        assert_eq!(days.hours()["2026-11-10T08"]["opus"], 10);
        let mut f = std::fs::OpenOptions::new().write(true).open(&main).unwrap();
        let head = reply("m1", "claude-opus-5-5", "2026-11-10T08:00:00Z", 10, 0);
        f.set_len(head.len() as u64).unwrap();
        f.seek(SeekFrom::End(0)).unwrap();
        // the reply streams on (same id), then a new one
        f.write_all((reply("m1", "claude-opus-5-5", "2026-11-10T08:00:00Z", 10, 30) + &reply("m2", "claude-opus-5-5", "2026-11-10T09:00:00Z", 1, 1)).as_bytes()).unwrap();
        drop(f);
        days.refresh(&d);
        let h = days.hours();
        assert_eq!(h["2026-11-10T08"]["opus"], 40);
        assert_eq!(h["2026-11-10T09"]["opus"], 2);
        // Claude Code cleans old transcripts up; the record keeps their days
        std::fs::remove_file(&main).unwrap();
        days.refresh(&d);
        assert_eq!(days.hours()["2026-11-10T08"]["opus"], 40);
        // and it survives a save and load
        let again: Days = serde_json::from_str(&serde_json::to_string(&days).unwrap()).unwrap();
        assert_eq!(again.hours()["2026-11-10T09"]["opus"], 2);
    }

    #[test]
    fn families() {
        assert_eq!(family("claude-fable-5-2"), "fable");
        assert_eq!(family("claude-opus-5-5"), "opus");
        assert_eq!(family("claude-haiku-4-5-20251001"), "haiku");
        assert_eq!(family("gpt-x"), "other");
    }
}
