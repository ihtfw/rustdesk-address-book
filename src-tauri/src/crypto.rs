use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{password_hash::SaltString, Argon2, Params};
use rand::rngs::OsRng;
use zeroize::Zeroize;

use crate::errors::AppError;

/// Header stored at start of the encrypted file.
/// Layout: [4 bytes version][22 bytes salt (base64)][12 bytes nonce][rest = ciphertext]
const FILE_VERSION: u32 = 1;
const SALT_LEN: usize = 22; // SaltString base64 length
const NONCE_LEN: usize = 12;
const HEADER_LEN: usize = 4 + SALT_LEN + NONCE_LEN; // 38 bytes

/// Derive a 256-bit key from password + salt using Argon2id.
fn derive_key(password: &str, salt: &SaltString) -> Result<[u8; 32], AppError> {
    let params = Params::new(19 * 1024, 2, 1, Some(32)).map_err(|e| AppError::Crypto(e.to_string()))?;
    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt.as_str().as_bytes(), &mut key)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    Ok(key)
}

/// Encrypt plaintext JSON bytes with a master password.
/// Returns the full blob: [version][salt][nonce][ciphertext].
pub fn encrypt(plaintext: &[u8], password: &str) -> Result<Vec<u8>, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let mut key = derive_key(password, &salt)?;

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    let nonce_bytes: [u8; NONCE_LEN] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    key.zeroize();

    // Build blob
    let mut blob = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    blob.extend_from_slice(&FILE_VERSION.to_le_bytes());
    blob.extend_from_slice(salt.as_str().as_bytes());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);

    Ok(blob)
}

/// Decrypt a blob back into plaintext JSON bytes using the master password.
pub fn decrypt(blob: &[u8], password: &str) -> Result<Vec<u8>, AppError> {
    if blob.len() < HEADER_LEN {
        return Err(AppError::Crypto("File too short".to_string()));
    }

    let version = u32::from_le_bytes(blob[0..4].try_into().unwrap());
    if version != FILE_VERSION {
        return Err(AppError::Crypto(format!(
            "Unsupported file version: {version}"
        )));
    }

    let salt_str = std::str::from_utf8(&blob[4..4 + SALT_LEN])
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    let salt =
        SaltString::from_b64(salt_str).map_err(|e| AppError::Crypto(e.to_string()))?;

    let nonce_bytes = &blob[4 + SALT_LEN..HEADER_LEN];
    let nonce = Nonce::from_slice(nonce_bytes);

    let ciphertext = &blob[HEADER_LEN..];

    let mut key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| AppError::Crypto("Decryption failed — wrong password or corrupted data".to_string()))?;

    key.zeroize();
    Ok(plaintext)
}

// ── Key-caching helpers for sync (avoid repeated KDF) ──

/// Derive a fresh key with a new random salt. Use for batch encryption.
pub fn make_key(password: &str) -> Result<([u8; 32], SaltString), AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let key = derive_key(password, &salt)?;
    Ok((key, salt))
}

/// Encrypt using a pre-derived key + salt (skips KDF).
/// Each call generates a unique nonce for security.
pub fn encrypt_with_key(plaintext: &[u8], key: &[u8; 32], salt: &SaltString) -> Result<Vec<u8>, AppError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    let nonce_bytes: [u8; NONCE_LEN] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    let mut blob = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    blob.extend_from_slice(&FILE_VERSION.to_le_bytes());
    blob.extend_from_slice(salt.as_str().as_bytes());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);

    Ok(blob)
}

/// Extract the salt string from a blob header (for key cache lookups).
pub fn extract_salt(blob: &[u8]) -> Result<String, AppError> {
    if blob.len() < HEADER_LEN {
        return Err(AppError::Crypto("File too short".to_string()));
    }
    let salt_str = std::str::from_utf8(&blob[4..4 + SALT_LEN])
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    Ok(salt_str.to_string())
}

/// Derive a key using a specific salt string (for cache misses on decrypt).
pub fn derive_key_with_salt(password: &str, salt_str: &str) -> Result<[u8; 32], AppError> {
    let salt = SaltString::from_b64(salt_str)
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    derive_key(password, &salt)
}

/// Decrypt a blob using a pre-derived key (skips KDF).
pub fn decrypt_with_key(blob: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, AppError> {
    if blob.len() < HEADER_LEN {
        return Err(AppError::Crypto("File too short".to_string()));
    }

    let version = u32::from_le_bytes(blob[0..4].try_into().unwrap());
    if version != FILE_VERSION {
        return Err(AppError::Crypto(format!("Unsupported file version: {version}")));
    }

    let nonce_bytes = &blob[4 + SALT_LEN..HEADER_LEN];
    let nonce = Nonce::from_slice(nonce_bytes);
    let ciphertext = &blob[HEADER_LEN..];

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| AppError::Crypto("Decryption failed — wrong password or corrupted data".to_string()))?;

    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let data = b"hello world address book";
        let password = "test-password-123";

        let blob = encrypt(data, password).unwrap();
        let decrypted = decrypt(&blob, password).unwrap();

        assert_eq!(data.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn wrong_password_fails() {
        let data = b"secret data";
        let blob = encrypt(data, "correct").unwrap();
        let result = decrypt(&blob, "wrong");
        assert!(result.is_err());
    }
}
