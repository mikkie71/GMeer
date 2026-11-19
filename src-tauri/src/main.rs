// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Het programma heet "GMeer" (met hoofdletters)
#![allow(non_snake_case)]

mod autostart;
mod google;
mod state;

use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};

/// Het GMeer-icoon (witte "G+" op blauw), ingebakken in de exe.
/// Opnieuw genereren: `python scripts/make_icon.py`
fn gmeer_icon() -> Image<'static> {
    Image::from_bytes(include_bytes!("../icons/tray.png"))
        .expect("icons/tray.png is geen geldige PNG")
        .to_owned()
}

/// Positioneert het venster netjes rechtsonder boven de Windows-taakbalk (Systeemvak)
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

/// Toont het venster rechtsonder in de gevraagde modus ("agenda" of "settings")
fn show_flyout(app: &AppHandle, mode: &str) {
    if let Some(window) = app.get_webview_window("main") {
        position_near_tray(&window);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("tray-mode", mode);
    }
}

/// Haalt een .ics-feed op via curl.exe (standaard aanwezig in Windows 10/11),
/// zodat de webview geen last heeft van CORS-blokkades van Google Agenda.
#[tauri::command]
async fn fetch_ics(url: String) -> Result<String, String> {
    let url = url.trim().to_string();
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Alleen http(s)-links worden ondersteund".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let output = std::process::Command::new("curl.exe")
            .args(["-s", "-S", "-L", "-f", "--max-time", "30", "--", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("curl.exe kon niet starten: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "Ophalen mislukt: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opent een http(s)-link in de standaardbrowser van Windows.
/// (window.open / target="_blank" werken niet in de Tauri-webview.)
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open_in_browser(url)
}

pub(crate) fn open_in_browser(url: String) -> Result<(), String> {
    let url = url.trim().to_string();
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Alleen http(s)-links worden ondersteund".into());
    }
    // Via rundll32 i.p.v. "cmd /C start", zodat tekens als & in de URL heel blijven
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Kon browser niet openen: {e}"))
}

/// Verbergt het venster naar de tray (zelfde als het kruisje); GMeer blijft draaien.
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
        // Maar één GMeer tegelijk: een tweede start toont gewoon het agendavenster van de eerste
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_flyout(app, "agenda");
        }))
        .invoke_handler(tauri::generate_handler![
            autostart::autostart_get,
            autostart::autostart_set,
            state::dismissed_load,
            state::dismissed_save,
            fetch_ics,
            open_url,
            hide_window,
            quit_app,
            google::google_status,
            google::google_connect,
            google::google_disconnect,
            google::google_move_event,
            google::google_create_event
        ])
        .setup(|app| {
            // Autostart-pad bijwerken als GMeer verplaatst/opnieuw geïnstalleerd is
            std::thread::spawn(autostart::repair_path);

            let tray_icon = gmeer_icon();

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(tray_icon.clone());
                position_near_tray(&window);
            }

            // Linkerklik: Agenda tonen/verbergen. Rechterklik: Instellingen (.ICS Kalenders & Opties).
            let _tray = TrayIconBuilder::with_id("GMeer-tray")
                .icon(tray_icon)
                .tooltip("GMeer — Linkerklik: Agenda | Rechterklik: Kalenders & Opties")
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
        .on_window_event(|window, event| {
            // Sluiten minimaliseert naar de System Tray
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running GMeer tauri application");
}
