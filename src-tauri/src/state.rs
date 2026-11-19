//! Durable storage of dismissed appointments in a file of their own.
//!
//! The webview's localStorage is written to disk with a delay when there are many writes;
//! if GMeer is then killed (restart, Windows shutdown, update) the latest changes are lost.
//! This file is written immediately and atomically (tmp + rename).

use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::ui::tr;

/// Appointment ID → end time (ISO), so old entries can be cleaned up later.
type DismissedMap = HashMap<String, String>;

fn dismissed_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("{} {e}", tr("Geen datamap:", "No data folder:")))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("dismissed.json"))
}

#[tauri::command]
pub fn dismissed_load(app: AppHandle) -> DismissedMap {
    dismissed_path(&app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn dismissed_save(app: AppHandle, map: DismissedMap) -> Result<(), String> {
    let path = dismissed_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| format!("{} {e}", tr("Opslaan mislukt:", "Saving failed:")))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("{} {e}", tr("Opslaan mislukt:", "Saving failed:")))
}
