mod commands;
mod crypto;
mod errors;
mod models;
mod rustdesk;
mod storage;

use commands::AppState;

fn init_logging() {
    let log_dir = storage::get_log_dir();
    let file_appender = tracing_appender::rolling::daily(&log_dir, "rustdesk-addressbook.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let _ = tracing_subscriber::fmt()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(false)
        .try_init();
    // Leak the guard so it lives for the entire process
    std::mem::forget(guard);
    tracing::info!("logging initialized, log_dir={}", log_dir.display());
    // Clean up old log files
    cleanup_old_logs(&log_dir, 10);
}

fn cleanup_old_logs(dir: &std::path::Path, keep_days: u64) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(keep_days * 86400);
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("rustdesk-addressbook.log.") { continue; }
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::address_book_exists,
            commands::get_storage_path,
            commands::set_storage_path,
            commands::check_file_exists,
            commands::get_recent_paths,
            commands::create_address_book,
            commands::unlock_address_book,
            commands::lock_address_book,
            commands::change_password,
            commands::get_tree,
            commands::add_folder,
            commands::add_connection,
            commands::update_folder,
            commands::update_connection,
            commands::delete_node,
            commands::undo_delete,
            commands::move_node,
            commands::connect,
            commands::get_rustdesk_path,
            commands::set_rustdesk_path,
            commands::detect_rustdesk,
            commands::get_auto_update,
            commands::set_auto_update,
            commands::get_language,
            commands::set_language,
            commands::export_nodes,
            commands::import_nodes,
            commands::try_import,
            commands::get_subscriptions,
            commands::add_subscription,
            commands::update_subscription,
            commands::remove_subscription,
            commands::sync_pull,
            commands::sync_push,
            commands::sync_subscription,
            commands::list_access_tokens,
            commands::create_access_token,
            commands::revoke_access_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Decrypt a blob using the master password, returning plaintext bytes.
/// Public API for CLI usage.
pub fn decrypt_blob(blob: &[u8], password: &str) -> Result<Vec<u8>, String> {
    crypto::decrypt(blob, password).map_err(|e| e.to_string())
}
