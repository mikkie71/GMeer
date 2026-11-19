//! "Starten met Windows": een waarde onder HKCU\...\CurrentVersion\Run (alleen voor deze gebruiker,
//! geen beheerdersrechten nodig). De installer zet deze standaard aan; in Opties is hij aan/uit te zetten.

use std::os::windows::process::CommandExt;
use std::process::Command;

use crate::ui::tr;

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "GMeer";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn reg(args: &[&str]) -> Result<String, String> {
    let out = Command::new("reg.exe")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("{} {e}", tr("reg.exe kon niet starten:", "Could not start reg.exe:")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn exe_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("\"{}\"", exe.display()))
}

/// Huidige waarde in de Run-sleutel (None = staat uit)
fn current_value() -> Option<String> {
    let out = reg(&["query", RUN_KEY, "/v", VALUE_NAME]).ok()?;
    // Regel ziet eruit als: "    GMeer    REG_SZ    "C:\...\GMeer.exe""
    out.lines()
        .find(|l| l.trim_start().starts_with(VALUE_NAME))
        .and_then(|l| l.split_once("REG_SZ"))
        .map(|(_, v)| v.trim().to_string())
}

pub fn set(enabled: bool) -> Result<(), String> {
    if enabled {
        let cmd = exe_command()?;
        reg(&["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", &cmd, "/f"]).map(|_| ())
    } else if current_value().is_some() {
        reg(&["delete", RUN_KEY, "/v", VALUE_NAME, "/f"]).map(|_| ())
    } else {
        Ok(())
    }
}

/// Bij het opstarten: als autostart aan staat maar naar een ander pad wijst
/// (bv. na verplaatsen of herinstalleren), het pad bijwerken naar deze exe.
pub fn repair_path() {
    if let (Some(current), Ok(wanted)) = (current_value(), exe_command()) {
        if !current.eq_ignore_ascii_case(&wanted) {
            let _ = set(true);
        }
    }
}

#[tauri::command]
pub fn autostart_get() -> bool {
    current_value().is_some()
}

#[tauri::command]
pub fn autostart_set(enabled: bool) -> Result<bool, String> {
    set(enabled)?;
    Ok(current_value().is_some())
}
