mod commands;
mod crypto;
mod errors;
mod models;
mod rustdesk;
mod storage;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            commands::move_node,
            commands::connect,
            commands::get_rustdesk_path,
            commands::set_rustdesk_path,
            commands::detect_rustdesk,
            commands::get_auto_update,
            commands::set_auto_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
