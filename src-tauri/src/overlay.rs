// The tray side: a tray icon, a transparent window standing on the taskbar above the tray where
// the open sessions' mochis peek up (shaking out seeds while they work) while you're in another
// app, and the taskbar button's working / needs-you state. The window lets clicks through except
// over a mochi, where a click opens that session.

use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};
use std::sync::Mutex;

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, UserAttentionType, WebviewUrl, WebviewWindowBuilder};

const W: f64 = 140.0; // overlay size at least, logical px
const H: f64 = 260.0;
/// Overlay width in screen px that fits every mochi (the page says, via overlay_hits).
static WIDTH: AtomicU32 = AtomicU32::new(0);

/// Where the mochis are in the overlay, screen px from its top-left: (tab, x, y, w, h).
static HITS: Mutex<Vec<(String, f64, f64, f64, f64)>> = Mutex::new(Vec::new());

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::with_id("main").tooltip("Mochi Garden").on_tray_icon_event(|tray, ev| match ev {
        TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => show_main(tray.app_handle()),
        TrayIconEvent::Enter { .. } | TrayIconEvent::Move { .. } => place(tray.app_handle()),
        _ => {}
    });
    if let Some(icon) = icon {
        tray = tray.icon(icon);
    }
    tray.build(app)?;

    let overlay = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("Mochi Garden seeds")
        .inner_size(W, H)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;
    overlay.set_ignore_cursor_events(true)?;
    place(app);
    overlay.show()?;
    watch_cursor(app.clone());
    Ok(())
}

/// The page's mochi rects and the width it needs for them, in screen px.
#[tauri::command]
pub fn overlay_hits(app: AppHandle, rects: Vec<serde_json::Value>, width: f64) {
    *HITS.lock().unwrap() = rects
        .iter()
        .map(|r| (r["tab"].as_str().unwrap_or_default().to_string(), r["x"].as_f64().unwrap_or(0.0), r["y"].as_f64().unwrap_or(0.0), r["w"].as_f64().unwrap_or(0.0), r["h"].as_f64().unwrap_or(0.0)))
        .collect();
    if WIDTH.swap(width.round() as u32, Ordering::Relaxed) != width.round() as u32 {
        place(&app);
    }
}

/// A mochi in the overlay was clicked: bring the garden up on its session.
#[tauri::command]
pub fn overlay_open(app: AppHandle, tab: String) {
    show_main(&app);
    let _ = app.emit_to("main", "open-tab", tab);
}

/// Clicks pass through the overlay except over a mochi: poll the cursor and switch.
fn watch_cursor(app: AppHandle) {
    std::thread::spawn(move || {
        let mut catching = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(60));
            let Some(overlay) = app.get_webview_window("overlay") else { continue };
            let over = (|| {
                // a copy: these window calls wait on the main thread, which may itself be waiting
                // for this lock (overlay_hits runs there), so holding it here would deadlock
                let hits = HITS.lock().unwrap().clone();
                if hits.is_empty() {
                    return Some(false);
                }
                let cur = overlay.cursor_position().ok()?;
                let pos = overlay.outer_position().ok()?;
                let (x, y) = (cur.x - pos.x as f64, cur.y - pos.y as f64);
                Some(hits.iter().any(|(_, hx, hy, hw, hh)| x >= *hx && x < hx + hw && y >= *hy && y < hy + hh))
            })()
            .unwrap_or(false);
            if over != catching {
                catching = over;
                let _ = overlay.set_ignore_cursor_events(!over);
            }
        }
    });
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    main_visibility(app);
}

/// Stand the overlay on top of the taskbar, centred over the tray icon (or the screen's
/// bottom-right corner when the icon is tucked into the overflow menu).
pub fn place(app: &AppHandle) {
    let Some(overlay) = app.get_webview_window("overlay") else { return };
    let Ok(Some(monitor)) = overlay.primary_monitor() else { return };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (w, h) = (((W * scale) as i32).max(WIDTH.load(Ordering::Relaxed) as i32), (H * scale) as i32);
    let right = area.position.x + area.size.width as i32;
    let bottom = area.position.y + area.size.height as i32;
    let mut cx = right - (60.0 * scale) as i32;
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(Some(rect)) = tray.rect() {
            let p = rect.position.to_physical::<i32>(scale);
            let s = rect.size.to_physical::<i32>(scale);
            // Only trust it when it is actually on the taskbar (not in the overflow flyout).
            if p.y + s.height >= bottom - 4 && p.x > area.position.x {
                cx = p.x + s.width / 2;
            }
        }
    }
    let x = (cx - w / 2).clamp(area.position.x, right - w);
    let _ = overlay.set_size(PhysicalSize::new(w as u32, h as u32));
    let _ = overlay.set_position(PhysicalPosition::new(x, bottom - h));
}

/// Taskbar button: an indeterminate progress glow while any mochi works; a flash when one
/// needs you and the window isn't focused.
#[tauri::command]
pub fn taskbar_state(app: AppHandle, working: bool, attention: bool) {
    let Some(main) = app.get_webview_window("main") else { return };
    let status = if working { ProgressBarStatus::Indeterminate } else { ProgressBarStatus::None };
    let _ = main.set_progress_bar(ProgressBarState { status: Some(status), progress: None });
    if attention && !main.is_focused().unwrap_or(false) {
        let _ = main.request_user_attention(Some(UserAttentionType::Informational));
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(if working { "Mochi Garden: mochis working" } else { "Mochi Garden" }));
    }
}

/// Tell the overlay whether the main window has focus (it only shows seeds when it doesn't).
pub fn main_focus(app: &AppHandle, focused: bool) {
    let _ = app.emit_to("overlay", "main-focus", focused);
    if !focused {
        place(app);
    }
    main_visibility(app);
}

/// Tell the garden whether it can be seen at all. WebView2 keeps the page "visible" while the
/// window is hidden in the tray or minimized, so the page would otherwise keep drawing for nobody.
pub fn main_visibility(app: &AppHandle) {
    static LAST: AtomicU8 = AtomicU8::new(2);
    let Some(w) = app.get_webview_window("main") else { return };
    let shown = w.is_visible().unwrap_or(true) && !w.is_minimized().unwrap_or(false);
    if LAST.swap(shown as u8, Ordering::Relaxed) != shown as u8 {
        let _ = app.emit_to("main", "main-visible", shown);
    }
}
