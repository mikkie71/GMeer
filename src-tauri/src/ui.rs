//! Venstergedrag en taal aan de Rust-kant:
//! - verbergen naar de tray zodra het venster de focus verliest (instelbaar)
//! - taal (nl/en) voor de tray-tooltip en meldingen vanuit Rust
//! - de Windows-weergavetaal bepalen voor de standaardtaal

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

static HIDE_ON_BLUR: AtomicBool = AtomicBool::new(true);
static LANG_EN: AtomicBool = AtomicBool::new(false);
static LAST_BLUR_HIDE: Mutex<Option<Instant>> = Mutex::new(None);

pub const TRAY_ID: &str = "GMeer-tray";

/// Kies de tekst in de huidige taal.
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
        "GMeer — Left-click: Agenda | Right-click: Calendars & Options",
    )
}

pub fn hide_on_blur() -> bool {
    HIDE_ON_BLUR.load(Ordering::Relaxed)
}

/// Onthoudt dat het venster net door focusverlies verborgen is.
pub fn mark_blur_hide() {
    if let Ok(mut t) = LAST_BLUR_HIDE.lock() {
        *t = Some(Instant::now());
    }
}

/// Is het venster zojuist (door een klik buiten het venster) verborgen? Dan moet een klik op
/// het tray-icoon het niet meteen weer openen: die klik was juist bedoeld om te sluiten.
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

/// Bewaakt of het venster de focus verliest en verbergt het dan naar de tray.
///
/// Windows stuurt geen betrouwbaar "focus kwijt"-event naar het hoofdvenster zolang de
/// WebView2 erin de toetsenbordfocus heeft. Daarom kijken we een paar keer per seconde welk
/// venster vooraan staat. Pas nadat GMeer zelf vooraan heeft gestaan ("armed"), leidt een
/// ander venster vooraan tot verbergen; zo verdwijnt het venster niet direct als Windows
/// het bij het tonen niet de focus gaf. Pop-ups van GMeer zelf (bv. een uitklaplijst) hebben
/// GMeer als eigenaar en tellen als "GMeer vooraan".
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

/// "nl" als de Windows-weergavetaal Nederlands is, anders "en".
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
}

#[tauri::command]
pub fn ui_set_hide_on_blur(enabled: bool) {
    HIDE_ON_BLUR.store(enabled, Ordering::Relaxed);
}
