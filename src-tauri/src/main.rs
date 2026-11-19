// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// The program is called "GMeer" (with capitals)
#![allow(non_snake_case)]

mod autostart;
mod google;
mod state;
mod ui;

use ui::tr;

use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};

/// The GMeer icon (white "G+" on blue), embedded in the exe.
/// Regenerate with: `python scripts/make_icon.py`
fn gmeer_icon() -> Image<'static> {
    Image::from_bytes(include_bytes!("../icons/tray.png"))
        .expect("icons/tray.png is not a valid PNG")
        .to_owned()
}

/// Positions the window in the bottom-right corner, above the Windows taskbar (system tray)
fn position_near_tray(window: &WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let screen_size = monitor.size();
        let screen_pos = monitor.position();
        let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize {
            width: 440,
            height: 640,
        });

        let x = screen_pos.x + (screen_size.width as i32) - (win_size.width as i32) - 16;
        let y = screen_pos.y + (screen_size.height as i32) - (win_size.height as i32) - 56;
        let _ = window.set_position(PhysicalPosition::new(x.max(0), y.max(0)));
    }
}

/// Shows the window bottom-right in the requested mode ("agenda" or "settings")
fn show_flyout(app: &AppHandle, mode: &str) {
    if let Some(window) = app.get_webview_window("main") {
        position_near_tray(&window);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("tray-mode", mode);
    }
}

/// Fetches an .ics feed via curl.exe (built into Windows 10/11),
/// so the webview is not affected by Google Calendar's CORS restrictions.
#[tauri::command]
async fn fetch_ics(url: String) -> Result<String, String> {
    let url = url.trim().to_string();
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(tr("Alleen http(s)-links worden ondersteund", "Only http(s) links are supported").into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let output = std::process::Command::new("curl.exe")
            .args(["-s", "-S", "-L", "-f", "--max-time", "30", "--", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("{} {e}", tr("curl.exe kon niet starten:", "Could not start curl.exe:")))?;
        if !output.status.success() {
            return Err(format!(
                "{} {}",
                tr("Ophalen mislukt:", "Download failed:"),
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens an http(s) link in the Windows default browser.
/// (window.open / target="_blank" do not work in the Tauri webview.)
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open_in_browser(url)
}

pub(crate) fn open_in_browser(url: String) -> Result<(), String> {
    let url = url.trim().to_string();
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(tr("Alleen http(s)-links worden ondersteund", "Only http(s) links are supported").into());
    }
    // Via rundll32 instead of "cmd /C start", so characters like & in the URL stay intact
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("{} {e}", tr("Kon browser niet openen:", "Could not open browser:")))
}

/// Reminder: shows the agenda window (used when an appointment becomes 'Soon' or 'Now').
#[tauri::command]
fn show_reminder(app: AppHandle) {
    show_flyout(&app, "agenda");
}

/// Hides the window to the tray (same as the window's X); GMeer keeps running.
#[tauri::command]
fn hide_window(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        // Only one GMeer at a time: a second start just shows the agenda window of the first
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_flyout(app, "agenda");
        }))
        .invoke_handler(tauri::generate_handler![
            autostart::autostart_get,
            autostart::autostart_set,
            state::dismissed_load,
            state::dismissed_save,
            ui::system_language,
            ui::ui_set_language,
            ui::ui_set_hide_on_blur,
            fetch_ics,
            open_url,
            hide_window,
            show_reminder,
            quit_app,
            google::google_status,
            google::google_connect,
            google::google_disconnect,
            google::google_move_event,
            google::google_create_event
        ])
        .setup(|app| {
            // Update the autostart path if GMeer was moved/reinstalled
            std::thread::spawn(autostart::repair_path);

            let tray_icon = gmeer_icon();

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(tray_icon.clone());
                position_near_tray(&window);
                // Click outside the window: hide to the tray (configurable under Options)
                ui::start_focus_watcher(window.clone());
            }

            // Left-click: show/hide the agenda. Right-click: settings (.ICS calendars & options).
            let _tray = TrayIconBuilder::with_id(ui::TRAY_ID)
                .icon(tray_icon)
                .tooltip(ui::tray_tooltip())
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        match button {
                            MouseButton::Left => {
                                let visible = app
                                    .get_webview_window("main")
                                    .and_then(|w| w.is_visible().ok())
                                    .unwrap_or(false);
                                if visible {
                                    if let Some(w) = app.get_webview_window("main") {
                                        let _ = w.hide();
                                    }
                                } else if ui::recently_hidden_by_blur() {
                                    // The click on the icon made the window lose focus and
                                    // hide itself: leave it hidden (this click meant "close").
                                } else {
                                    show_flyout(app, "agenda");
                                }
                            }
                            MouseButton::Right => show_flyout(app, "settings"),
                            _ => {}
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing hides the window to the system tray
            WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running GMeer tauri application");
}
