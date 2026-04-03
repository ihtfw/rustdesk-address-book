use std::fs;
use std::path::PathBuf;

use crate::crypto;
use crate::errors::AppError;
use crate::models::AddressBook;

const APP_DIR_NAME: &str = "rustdesk-address-book";
const FILE_NAME: &str = "addressbook.enc";

/// Get the path to the encrypted address book file.
pub fn get_file_path() -> Result<PathBuf, AppError> {
    let data_dir = dirs::data_local_dir()
        .ok_or_else(|| AppError::Storage("Cannot determine local data directory".to_string()))?;
    Ok(data_dir.join(APP_DIR_NAME).join(FILE_NAME))
}

/// Check if an address book file already exists.
pub fn exists() -> Result<bool, AppError> {
    let path = get_file_path()?;
    Ok(path.exists())
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
