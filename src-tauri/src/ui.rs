//! Window behaviour and language on the Rust side:
//! - hide to the tray as soon as the window loses focus (configurable)
//! - language (nl/en) for the tray tooltip, window title and messages from Rust
//! - detect the Windows display language for the default language

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

static HIDE_ON_BLUR: AtomicBool = AtomicBool::new(true);
static LANG_EN: AtomicBool = AtomicBool::new(false);
static LAST_BLUR_HIDE: Mutex<Option<Instant>> = Mutex::new(None);

pub const TRAY_ID: &str = "GMeer-tray";

/// Picks the text in the current language.
pub fn tr<'a>(nl: &'a str, en: &'a str) -> &'a str {
    if LANG_EN.load(Ordering::Relaxed) {
        en
    } else {
        nl
    }
}

pub fn tray_tooltip() -> &'static str {
    tr(
        "GMeer — Linkerklik: Agenda | Rechterklik: Kalenders & Opties",
        "GMeer — Left-click: Calendar | Right-click: Calendars & Options",
    )
}

pub fn window_title() -> &'static str {
    tr("GMeer — Google Agenda Tray", "GMeer — Google Calendar Tray")
}

pub fn hide_on_blur() -> bool {
    HIDE_ON_BLUR.load(Ordering::Relaxed)
}

/// Remembers that the window was just hidden because it lost focus.
pub fn mark_blur_hide() {
    if let Ok(mut t) = LAST_BLUR_HIDE.lock() {
        *t = Some(Instant::now());
    }
}

/// Was the window just hidden (by a click outside it)? Then a click on the tray icon must not
/// reopen it right away: that click was meant to close it.
pub fn recently_hidden_by_blur() -> bool {
    LAST_BLUR_HIDE
        .lock()
        .ok()
        .and_then(|t| *t)
        .map(|t| t.elapsed() < Duration::from_millis(500))
        .unwrap_or(false)
}

#[link(name = "kernel32")]
extern "system" {
    fn GetUserDefaultUILanguage() -> u16;
}

#[link(name = "user32")]
extern "system" {
    fn GetForegroundWindow() -> isize;
    fn GetAncestor(hwnd: isize, flags: u32) -> isize;
}

/// Watches whether the window loses focus and then hides it to the tray.
///
/// Windows does not send a reliable "focus lost" event to the main window while the WebView2
/// inside it holds keyboard focus. So we check a few times per second which window is in the
/// foreground. Only after GMeer itself has been in front ("armed") does another foreground
/// window cause hiding; that way the window does not vanish right away when Windows did not give
/// it focus on showing. GMeer's own pop-ups (e.g. a dropdown list) are owned by GMeer and count
/// as "GMeer in front".
pub fn start_focus_watcher(window: tauri::WebviewWindow) {
    const GA_ROOTOWNER: u32 = 3;
    std::thread::spawn(move || {
        let mut armed = false;
        loop {
            std::thread::sleep(Duration::from_millis(150));
            let visible = window.is_visible().unwrap_or(false);
            if !visible {
                armed = false;
                continue;
            }
            let Ok(ours) = window.hwnd() else { continue };
            let ours = ours.0 as isize;
            let fg = unsafe { GetForegroundWindow() };
            let fg_root = if fg == 0 { 0 } else { unsafe { GetAncestor(fg, GA_ROOTOWNER) } };
            if fg == ours || fg_root == ours {
                armed = true;
            } else if armed && fg != 0 && hide_on_blur() {
                armed = false;
                mark_blur_hide();
                let _ = window.hide();
            }
        }
    });
}

/// "nl" if the Windows display language is Dutch, otherwise "en".
#[tauri::command]
pub fn system_language() -> &'static str {
    const LANG_DUTCH: u16 = 0x13;
    let langid = unsafe { GetUserDefaultUILanguage() };
    if langid & 0x3ff == LANG_DUTCH {
        "nl"
    } else {
        "en"
    }
}

#[tauri::command]
pub fn ui_set_language(app: AppHandle, lang: String) {
    LANG_EN.store(lang != "nl", Ordering::Relaxed);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tray_tooltip()));
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(window_title());
    }
}

#[tauri::command]
pub fn ui_set_hide_on_blur(enabled: bool) {
    HIDE_ON_BLUR.store(enabled, Ordering::Relaxed);
}
