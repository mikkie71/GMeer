//! Google Calendar API connection, so GMeer can move and add appointments in the
//! background ("To tomorrow" and quick add).
//!
//! - One-time connection via OAuth 2.0 (desktop app, loopback + PKCE): the browser opens once
//!   for consent. After that only the refresh token is used, without anything on screen.
//! - HTTP traffic goes through curl.exe (built into Windows 10/11). Sensitive values (tokens,
//!   secret) are passed to curl via stdin, so they never appear on the command line.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::ui::tr;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";

#[derive(Serialize, Deserialize, Default, Clone)]
struct GoogleConfig {
    client_id: String,
    client_secret: String,
    refresh_token: Option<String>,
}

#[derive(Serialize)]
pub struct GoogleStatus {
    configured: bool,
    connected: bool,
    client_id: String,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("{} {e}", tr("Geen configuratiemap:", "No config folder:")))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("google.json"))
}

fn load_config(app: &AppHandle) -> GoogleConfig {
    config_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, cfg: &GoogleConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("{} {e}", tr("Opslaan mislukt:", "Saving failed:")))
}

/// Escapes a value for a curl config file (between double quotes).
fn curl_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Performs an HTTP request via curl.exe; all options go through stdin (-K -).
/// Returns (status code, body).
fn curl_request(
    method: &str,
    url: &str,
    headers: &[String],
    body: Option<&str>,
) -> Result<(u16, String), String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut config = String::new();
    config.push_str(&format!("url = {}\n", curl_quote(url)));
    config.push_str(&format!("request = {}\n", curl_quote(method)));
    config.push_str("silent\nshow-error\n");
    config.push_str("max-time = 30\n");
    config.push_str(&format!("write-out = {}\n", curl_quote("\n%{http_code}")));
    for h in headers {
        config.push_str(&format!("header = {}\n", curl_quote(h)));
    }
    if let Some(b) = body {
        config.push_str(&format!("data-binary = {}\n", curl_quote(b)));
    }

    let mut child = Command::new("curl.exe")
        .args(["-K", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("{} {e}", tr("curl.exe kon niet starten:", "Could not start curl.exe:")))?;
    child
        .stdin
        .take()
        .ok_or(tr("Geen stdin voor curl", "No stdin for curl"))?
        .write_all(config.as_bytes())
        .map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    let (body, code) = text.rsplit_once('\n').unwrap_or(("", text.as_str()));
    let code: u16 = code.trim().parse().unwrap_or(0);
    if code == 0 {
        return Err(format!(
            "{} {}",
            tr("Geen verbinding met Google:", "No connection to Google:"),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok((code, body.to_string()))
}

fn form_encode(pairs: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(pairs)
        .finish()
}

fn google_error_message(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    v["error"]["message"]
        .as_str()
        .or_else(|| v["error_description"].as_str())
        .or_else(|| v["error"].as_str())
        .unwrap_or(body)
        .to_string()
}

fn random_urlsafe(len: usize) -> Result<String, String> {
    let mut buf = vec![0u8; len];
    getrandom::fill(&mut buf).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf))
}

/// Waits for Google's redirect to http://127.0.0.1:<port>/?code=...
fn wait_for_auth_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);

    loop {
        if Instant::now() > deadline {
            return Err(tr(
                "Koppelen afgebroken: geen antwoord van Google binnen 5 minuten",
                "Connecting cancelled: no response from Google within 5 minutes",
            )
            .into());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);
        let path = req
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .unwrap_or("/");

        let parsed = url::Url::parse(&format!("http://127.0.0.1{path}"))
            .map_err(|e| e.to_string())?;
        let get = |k: &str| {
            parsed
                .query_pairs()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.into_owned())
        };

        let (ok, message) = match (get("code"), get("error")) {
            (Some(code), _) if get("state").as_deref() == Some(expected_state) => {
                (
                    Some(code),
                    tr(
                        "GMeer is gekoppeld aan Google Agenda. Je kunt dit tabblad sluiten.",
                        "GMeer is connected to Google Calendar. You can close this tab.",
                    ),
                )
            }
            (_, Some(_)) => (
                None,
                tr(
                    "Koppelen geweigerd of afgebroken. Je kunt dit tabblad sluiten.",
                    "Connecting was denied or cancelled. You can close this tab.",
                ),
            ),
            _ => {
                // E.g. a favicon request: ignore it and keep waiting
                let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                continue;
            }
        };

        let html = format!(
            "<!doctype html><meta charset=utf-8><title>GMeer</title>\
             <body style=\"font-family:Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;\
             display:flex;align-items:center;justify-content:center;height:100vh;margin:0\">\
             <p style=\"font-size:18px\">{message}</p></body>"
        );
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(),
                html
            )
            .as_bytes(),
        );
        return ok.ok_or_else(|| tr("Koppelen geweigerd in Google", "Connecting was denied in Google").to_string());
    }
}

fn get_access_token(cfg: &GoogleConfig) -> Result<String, String> {
    let refresh = cfg
        .refresh_token
        .as_deref()
        .ok_or(tr(
            "Nog niet gekoppeld met Google (zie Opties)",
            "Not connected to Google yet (see Options)",
        ))?;
    let body = form_encode(&[
        ("client_id", &cfg.client_id),
        ("client_secret", &cfg.client_secret),
        ("refresh_token", refresh),
        ("grant_type", "refresh_token"),
    ]);
    let (code, resp) = curl_request(
        "POST",
        TOKEN_URL,
        &["Content-Type: application/x-www-form-urlencoded".into()],
        Some(&body),
    )?;
    if code != 200 {
        return Err(format!(
            "{} ({code}): {}. {}",
            tr("Google-token vernieuwen mislukt", "Refreshing the Google token failed"),
            google_error_message(&resp),
            tr("Koppel opnieuw via Opties.", "Reconnect via Options.")
        ));
    }
    let v: Value = serde_json::from_str(&resp).map_err(|e| e.to_string())?;
    v["access_token"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| tr("Geen access_token van Google ontvangen", "No access_token received from Google").into())
}

#[tauri::command]
pub fn google_status(app: AppHandle) -> GoogleStatus {
    let cfg = load_config(&app);
    GoogleStatus {
        configured: !cfg.client_id.is_empty() && !cfg.client_secret.is_empty(),
        connected: cfg.refresh_token.is_some(),
        client_id: cfg.client_id,
    }
}

/// One-time connection: opens Google's consent page in the browser and waits for the answer.
#[tauri::command]
pub async fn google_connect(
    app: AppHandle,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    let client_id = client_id.trim().to_string();
    let client_secret = client_secret.trim().to_string();
    if client_id.is_empty() || client_secret.is_empty() {
        return Err(tr(
            "Vul zowel Client ID als Client secret in",
            "Please enter both Client ID and Client secret",
        )
        .into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let redirect_uri = format!("http://127.0.0.1:{port}");

        let verifier = random_urlsafe(48)?;
        let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(Sha256::digest(verifier.as_bytes()));
        let state = random_urlsafe(16)?;

        let mut auth = url::Url::parse(AUTH_URL).map_err(|e| e.to_string())?;
        auth.query_pairs_mut()
            .append_pair("client_id", &client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", SCOPE)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent")
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state);

        crate::open_in_browser(auth.to_string())?;
        let code = wait_for_auth_code(listener, &state)?;

        let body = form_encode(&[
            ("client_id", &client_id),
            ("client_secret", &client_secret),
            ("code", &code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect_uri),
            ("grant_type", "authorization_code"),
        ]);
        let (status, resp) = curl_request(
            "POST",
            TOKEN_URL,
            &["Content-Type: application/x-www-form-urlencoded".into()],
            Some(&body),
        )?;
        if status != 200 {
            return Err(format!(
                "{} ({status}): {}",
                tr("Token ophalen mislukt", "Getting the token failed"),
                google_error_message(&resp)
            ));
        }
        let v: Value = serde_json::from_str(&resp).map_err(|e| e.to_string())?;
        let refresh = v["refresh_token"]
            .as_str()
            .ok_or(tr(
                "Google gaf geen refresh-token terug; probeer opnieuw te koppelen",
                "Google returned no refresh token; please try connecting again",
            ))?;

        save_config(
            &app,
            &GoogleConfig {
                client_id,
                client_secret,
                refresh_token: Some(refresh.to_string()),
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn google_disconnect(app: AppHandle) -> Result<(), String> {
    let mut cfg = load_config(&app);
    cfg.refresh_token = None;
    save_config(&app, &cfg)
}

/// Moves one appointment (or one instance of a series) in Google Calendar.
/// `start`/`end` are RFC3339 (timed) or YYYY-MM-DD (all-day).
#[tauri::command]
pub async fn google_move_event(
    app: AppHandle,
    calendar_id: String,
    event_id: String,
    start: String,
    end: String,
    all_day: bool,
    time_zone: Option<String>,
) -> Result<(), String> {
    let cfg = load_config(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let token = get_access_token(&cfg)?;

        let point = |value: &str| {
            if all_day {
                json!({ "date": value, "dateTime": null })
            } else {
                match &time_zone {
                    Some(tz) => json!({ "dateTime": value, "timeZone": tz, "date": null }),
                    None => json!({ "dateTime": value, "date": null }),
                }
            }
        };
        let body = json!({ "start": point(&start), "end": point(&end) }).to_string();

        let enc = |s: &str| {
            url::form_urlencoded::byte_serialize(s.as_bytes())
                .collect::<String>()
                .replace('+', "%20")
        };
        let url = format!(
            "https://www.googleapis.com/calendar/v3/calendars/{}/events/{}?sendUpdates=none",
            enc(&calendar_id),
            enc(&event_id)
        );

        let (status, resp) = curl_request(
            "PATCH",
            &url,
            &[
                format!("Authorization: Bearer {token}"),
                "Content-Type: application/json".into(),
            ],
            Some(&body),
        )?;
        match status {
            200 => Ok(()),
            404 => Err(tr(
                "Afspraak niet gevonden in Google Agenda",
                "Appointment not found in Google Calendar",
            )
            .into()),
            403 => Err(format!(
                "{} {}",
                tr(
                    "Geen rechten om deze afspraak te wijzigen:",
                    "No permission to change this appointment:"
                ),
                google_error_message(&resp)
            )),
            _ => Err(format!(
                "{} {status}: {}",
                tr("Google gaf fout", "Google returned error"),
                google_error_message(&resp)
            )),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Creates a new appointment in Google Calendar and returns its Google event ID.
/// `start`/`end` are RFC3339 with offset (e.g. 2026-11-19T18:03:00+01:00).
#[tauri::command]
pub async fn google_create_event(
    app: AppHandle,
    calendar_id: String,
    title: String,
    start: String,
    end: String,
    time_zone: Option<String>,
) -> Result<String, String> {
    let cfg = load_config(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let token = get_access_token(&cfg)?;

        let point = |value: &str| match &time_zone {
            Some(tz) => json!({ "dateTime": value, "timeZone": tz }),
            None => json!({ "dateTime": value }),
        };
        let body = json!({
            "summary": title,
            "start": point(&start),
            "end": point(&end),
        })
        .to_string();

        let enc = url::form_urlencoded::byte_serialize(calendar_id.as_bytes())
            .collect::<String>()
            .replace('+', "%20");
        let url = format!(
            "https://www.googleapis.com/calendar/v3/calendars/{enc}/events?sendUpdates=none"
        );

        let (status, resp) = curl_request(
            "POST",
            &url,
            &[
                format!("Authorization: Bearer {token}"),
                "Content-Type: application/json; charset=utf-8".into(),
            ],
            Some(&body),
        )?;
        if status != 200 {
            return Err(format!(
                "{} ({status}): {}",
                tr("Aanmaken mislukt", "Creating failed"),
                google_error_message(&resp)
            ));
        }
        let v: Value = serde_json::from_str(&resp).map_err(|e| e.to_string())?;
        v["id"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| tr("Google gaf geen afspraak-ID terug", "Google returned no appointment ID").into())
    })
    .await
    .map_err(|e| e.to_string())?
}
