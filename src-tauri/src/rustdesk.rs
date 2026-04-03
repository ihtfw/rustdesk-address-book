use std::process::Command;

use crate::errors::AppError;

/// Auto-detect the RustDesk executable path for the current platform.
pub fn detect_path() -> Option<String> {
    // Try PATH first
    if let Ok(path) = which::which("rustdesk") {
        return Some(path.to_string_lossy().to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files\RustDesk\rustdesk.exe",
            r"C:\Program Files (x86)\RustDesk\rustdesk.exe",
        ];
        for c in &candidates {
            if std::path::Path::new(c).exists() {
                return Some(c.to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let app_path = "/Applications/RustDesk.app/Contents/MacOS/RustDesk";
        if std::path::Path::new(app_path).exists() {
            return Some(app_path.to_string());
        }
    }

    #[cfg(target_os = "linux")]
    {
        let candidates = ["/usr/bin/rustdesk", "/usr/local/bin/rustdesk"];
        for c in &candidates {
            if std::path::Path::new(c).exists() {
                return Some(c.to_string());
            }
        }
    }

    None
}

/// Launch RustDesk with --connect and optionally --password.
pub fn connect(
    rustdesk_path: &str,
    rustdesk_id: &str,
    password: Option<&str>,
) -> Result<(), AppError> {
    if !std::path::Path::new(rustdesk_path).exists() {
        return Err(AppError::RustDeskNotFound(format!(
            "RustDesk executable not found at: {rustdesk_path}"
        )));
    }

    let mut cmd = Command::new(rustdesk_path);
    cmd.arg("--connect").arg(rustdesk_id);

    if let Some(pw) = password {
        if !pw.is_empty() {
            cmd.arg("--password").arg(pw);
        }
    }

    // Spawn detached — we don't wait for RustDesk to exit
    cmd.spawn()
        .map_err(|e| AppError::General(format!("Failed to launch RustDesk: {e}")))?;

    Ok(())
}
