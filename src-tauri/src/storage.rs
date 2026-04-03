use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::errors::AppError;
use crate::models::AddressBook;

const APP_DIR_NAME: &str = "rustdesk-address-book";
const FILE_NAME: &str = "addressbook.enc";
const CONFIG_FILE: &str = "config.json";

/// Simple config stored alongside the app (not encrypted).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    /// Custom path to the address book file. If None, uses default location.
    #[serde(default)]
    pub storage_path: Option<String>,
    /// Whether to automatically check for updates. Defaults to true.
    #[serde(default = "default_true")]
    pub auto_update: bool,
    /// UI language code (e.g. "en", "ru"). Defaults to "en".
    #[serde(default = "default_lang")]
    pub language: String,
}

fn default_true() -> bool {
    true
}

fn default_lang() -> String {
    "en".to_string()
}

/// Get the app config directory (always in the default location).
fn get_config_dir() -> Result<PathBuf, AppError> {
    let data_dir = dirs::data_local_dir()
        .ok_or_else(|| AppError::Storage("Cannot determine local data directory".to_string()))?;
    Ok(data_dir.join(APP_DIR_NAME))
}

/// Load the app config.
pub fn load_config() -> Result<AppConfig, AppError> {
    let path = get_config_dir()?.join(CONFIG_FILE);
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let data = fs::read_to_string(&path).map_err(|e| AppError::Storage(e.to_string()))?;
    serde_json::from_str(&data).map_err(|e| AppError::Storage(e.to_string()))
}

/// Save the app config.
pub fn save_config(config: &AppConfig) -> Result<(), AppError> {
    let dir = get_config_dir()?;
    fs::create_dir_all(&dir).map_err(|e| AppError::Storage(e.to_string()))?;
    let data = serde_json::to_string_pretty(config).map_err(|e| AppError::Storage(e.to_string()))?;
    fs::write(dir.join(CONFIG_FILE), data).map_err(|e| AppError::Storage(e.to_string()))
}

/// Get the default path to the encrypted address book file.
pub fn default_file_path() -> Result<PathBuf, AppError> {
    Ok(get_config_dir()?.join(FILE_NAME))
}

/// Get the path to the encrypted address book file (custom or default).
pub fn get_file_path() -> Result<PathBuf, AppError> {
    let config = load_config()?;
    match config.storage_path {
        Some(ref p) if !p.is_empty() => Ok(PathBuf::from(p)),
        _ => default_file_path(),
    }
}

/// Get the current storage path as a string (for display in UI).
pub fn get_storage_path_display() -> Result<String, AppError> {
    let path = get_file_path()?;
    Ok(path.to_string_lossy().to_string())
}

/// Set a custom storage path. If empty, revert to default.
pub fn set_storage_path(path: &str) -> Result<(), AppError> {
    let mut config = load_config()?;
    if path.is_empty() {
        config.storage_path = None;
    } else {
        config.storage_path = Some(path.to_string());
    }
    save_config(&config)
}

/// Check if an address book file already exists at the configured path.
pub fn exists() -> Result<bool, AppError> {
    let path = get_file_path()?;
    Ok(path.exists())
}

/// Check if an address book file exists at a specific path.
pub fn exists_at(file_path: &str) -> bool {
    PathBuf::from(file_path).exists()
}

/// Create a new empty address book, encrypt it, and save to disk.
pub fn create_new(password: &str) -> Result<AddressBook, AppError> {
    let book = AddressBook::new();
    save(&book, password)?;
    Ok(book)
}

/// Open an existing address book by decrypting it with the password.
pub fn open(password: &str) -> Result<AddressBook, AppError> {
    let path = get_file_path()?;
    let blob = fs::read(&path).map_err(|e| AppError::Storage(e.to_string()))?;
    let plaintext = crypto::decrypt(&blob, password)?;
    let book: AddressBook =
        serde_json::from_slice(&plaintext).map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(book)
}

/// Save the address book: serialize → encrypt → atomic write.
pub fn save(book: &AddressBook, password: &str) -> Result<(), AppError> {
    let plaintext =
        serde_json::to_vec(book).map_err(|e| AppError::Storage(e.to_string()))?;
    let blob = crypto::encrypt(&plaintext, password)?;

    let path = get_file_path()?;

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Storage(e.to_string()))?;
    }

    // Atomic write: write to temp file, then rename
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, &blob).map_err(|e| AppError::Storage(e.to_string()))?;
    fs::rename(&tmp_path, &path).map_err(|e| AppError::Storage(e.to_string()))?;

    // Set restrictive permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, perms)
            .map_err(|e| AppError::Storage(e.to_string()))?;
    }

    Ok(())
}

/// Re-encrypt the address book with a new password.
pub fn change_password(old_password: &str, new_password: &str) -> Result<(), AppError> {
    let book = open(old_password)?;
    save(&book, new_password)?;
    Ok(())
}
