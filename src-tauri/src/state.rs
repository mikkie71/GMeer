//! Duurzame opslag van weggeklikte (dismissed) afspraken in een eigen bestand.
//!
//! localStorage van de webview wordt bij veel schrijfacties vertraagd naar schijf geschreven;
//! wordt GMeer dan hard gestopt (herstart, Windows afsluiten, update) dan gaan de laatste
//! wijzigingen verloren. Dit bestand wordt direct en atomair (tmp + rename) geschreven.

use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::ui::tr;

/// Afspraak-ID → eindtijd (ISO), zodat oude regels later opgeruimd kunnen worden.
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
