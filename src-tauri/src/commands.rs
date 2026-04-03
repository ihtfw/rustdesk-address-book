use std::sync::Mutex;

use chrono::Utc;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{AddressBook, Connection, Folder, TreeNode};
use crate::rustdesk;
use crate::storage;

/// Application state held in Tauri's managed state.
pub struct AppState {
    pub address_book: Mutex<Option<AddressBook>>,
    pub master_password: Mutex<Option<String>>,
    pub rustdesk_path: Mutex<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            address_book: Mutex::new(None),
            master_password: Mutex::new(None),
            rustdesk_path: Mutex::new(None),
        }
    }
}

fn get_book_and_save(state: &AppState) -> Result<(), AppError> {
    let book = state.address_book.lock().unwrap();
    let pw = state.master_password.lock().unwrap();
    match (book.as_ref(), pw.as_ref()) {
        (Some(b), Some(p)) => storage::save(b, p),
        _ => Err(AppError::Locked),
    }
}

// ─── Auth Commands ───────────────────────────────────────────────

#[tauri::command]
pub fn address_book_exists() -> Result<bool, AppError> {
    storage::exists()
}

#[tauri::command]
pub fn get_storage_path() -> Result<String, AppError> {
    storage::get_storage_path_display()
}

#[tauri::command]
pub fn set_storage_path(path: String) -> Result<(), AppError> {
    storage::set_storage_path(&path)
}

#[tauri::command]
pub fn check_file_exists(path: String) -> bool {
    storage::exists_at(&path)
}

#[tauri::command]
pub fn create_address_book(
    state: tauri::State<'_, AppState>,
    password: String,
) -> Result<Folder, AppError> {
    let book = storage::create_new(&password)?;
    let root = book.root.clone();
    *state.address_book.lock().unwrap() = Some(book);
    *state.master_password.lock().unwrap() = Some(password);

    // Auto-detect RustDesk path
    if let Some(path) = rustdesk::detect_path() {
        *state.rustdesk_path.lock().unwrap() = Some(path);
    }

    Ok(root)
}

#[tauri::command]
pub fn unlock_address_book(
    state: tauri::State<'_, AppState>,
    password: String,
) -> Result<Folder, AppError> {
    let book = storage::open(&password)?;
    let root = book.root.clone();
    *state.address_book.lock().unwrap() = Some(book);
    *state.master_password.lock().unwrap() = Some(password);

    // Auto-detect RustDesk path
    if let Some(path) = rustdesk::detect_path() {
        *state.rustdesk_path.lock().unwrap() = Some(path);
    }

    Ok(root)
}

#[tauri::command]
pub fn lock_address_book(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    *state.address_book.lock().unwrap() = None;
    *state.master_password.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn change_password(
    state: tauri::State<'_, AppState>,
    old_password: String,
    new_password: String,
) -> Result<(), AppError> {
    storage::change_password(&old_password, &new_password)?;
    *state.master_password.lock().unwrap() = Some(new_password);
    Ok(())
}

// ─── Tree CRUD Commands ──────────────────────────────────────────

#[tauri::command]
pub fn get_tree(state: tauri::State<'_, AppState>) -> Result<Folder, AppError> {
    let book = state.address_book.lock().unwrap();
    book.as_ref().map(|b| b.root.clone()).ok_or(AppError::Locked)
}

#[tauri::command]
pub fn add_folder(
    state: tauri::State<'_, AppState>,
    parent_id: Uuid,
    name: String,
    description: String,
) -> Result<Folder, AppError> {
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    let new_folder = Folder {
        id: Uuid::new_v4(),
        name,
        description,
        children: Vec::new(),
    };

    let parent = book
        .find_folder_mut(parent_id)
        .ok_or_else(|| AppError::General("Parent folder not found".to_string()))?;
    let result = new_folder.clone();
    parent.children.push(TreeNode::Folder(new_folder));

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(result)
}

#[tauri::command]
pub fn add_connection(
    state: tauri::State<'_, AppState>,
    parent_id: Uuid,
    name: String,
    description: String,
    rustdesk_id: String,
    password: String,
) -> Result<Connection, AppError> {
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    let now = Utc::now();
    let new_conn = Connection {
        id: Uuid::new_v4(),
        name,
        description,
        rustdesk_id,
        password,
        created_at: now,
        updated_at: now,
    };

    let parent = book
        .find_folder_mut(parent_id)
        .ok_or_else(|| AppError::General("Parent folder not found".to_string()))?;
    let result = new_conn.clone();
    parent.children.push(TreeNode::Connection(new_conn));

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(result)
}

#[tauri::command]
pub fn update_folder(
    state: tauri::State<'_, AppState>,
    id: Uuid,
    name: String,
    description: String,
) -> Result<Folder, AppError> {
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    let folder = book
        .find_folder_mut(id)
        .ok_or_else(|| AppError::General("Folder not found".to_string()))?;
    folder.name = name;
    folder.description = description;
    let result = folder.clone();

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(result)
}

/// Helper: find a mutable connection reference in the tree.
fn find_connection_mut(folder: &mut Folder, target_id: Uuid) -> Option<&mut Connection> {
    for child in &mut folder.children {
        match child {
            TreeNode::Connection(ref mut c) if c.id == target_id => return Some(c),
            TreeNode::Folder(ref mut f) => {
                if let Some(found) = find_connection_mut(f, target_id) {
                    return Some(found);
                }
            }
            _ => {}
        }
    }
    None
}

#[tauri::command]
pub fn update_connection(
    state: tauri::State<'_, AppState>,
    id: Uuid,
    name: String,
    description: String,
    rustdesk_id: String,
    password: String,
) -> Result<Connection, AppError> {
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    let conn = find_connection_mut(&mut book.root, id)
        .ok_or_else(|| AppError::General("Connection not found".to_string()))?;
    conn.name = name;
    conn.description = description;
    conn.rustdesk_id = rustdesk_id;
    conn.password = password;
    conn.updated_at = Utc::now();
    let result = conn.clone();

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(result)
}

#[tauri::command]
pub fn delete_node(state: tauri::State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    if !book.delete_node(id) {
        return Err(AppError::General("Node not found".to_string()));
    }

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(())
}

#[tauri::command]
pub fn move_node(
    state: tauri::State<'_, AppState>,
    node_id: String,
    new_parent_id: String,
    position: usize,
) -> Result<(), AppError> {
    let node_uuid = Uuid::parse_str(&node_id)
        .map_err(|e| AppError::General(format!("Invalid node ID '{}': {}", node_id, e)))?;
    let parent_uuid = Uuid::parse_str(&new_parent_id)
        .map_err(|e| AppError::General(format!("Invalid parent ID '{}': {}", new_parent_id, e)))?;

    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;
    book.move_node(node_uuid, parent_uuid, position)?;

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(())
}

// ─── Connection Launch Commands ──────────────────────────────────

#[tauri::command]
pub fn connect(state: tauri::State<'_, AppState>, connection_id: String) -> Result<String, AppError> {
    let uuid = Uuid::parse_str(&connection_id)
        .map_err(|e| AppError::General(format!("Invalid connection ID '{}': {}", connection_id, e)))?;

    let book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_ref().ok_or(AppError::Locked)?;

    let conn = book
        .find_connection(uuid)
        .ok_or_else(|| AppError::General(format!("Connection not found: {}", connection_id)))?;

    // Clone connection data before dropping the lock
    let rustdesk_id = conn.rustdesk_id.clone();
    let password = conn.password.clone();
    drop(book_lock);

    // Try to get cached path, or auto-detect
    let mut rd_path_lock = state.rustdesk_path.lock().unwrap();
    if rd_path_lock.is_none() {
        *rd_path_lock = rustdesk::detect_path();
    }
    let rd_path = rd_path_lock
        .as_ref()
        .ok_or_else(|| {
            AppError::RustDeskNotFound(
                "RustDesk not found. Install RustDesk or set the path in Settings.".to_string(),
            )
        })?
        .clone();
    drop(rd_path_lock);

    let pw = if password.is_empty() {
        None
    } else {
        Some(password.as_str())
    };

    rustdesk::connect(&rd_path, &rustdesk_id, pw)?;
    Ok(format!("Launched RustDesk: {} -> {}", rd_path, rustdesk_id))
}

#[tauri::command]
pub fn get_rustdesk_path(state: tauri::State<'_, AppState>) -> Result<String, AppError> {
    let path = state.rustdesk_path.lock().unwrap();
    Ok(path.clone().unwrap_or_default())
}

#[tauri::command]
pub fn set_rustdesk_path(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), AppError> {
    if !path.is_empty() && !std::path::Path::new(&path).exists() {
        return Err(AppError::RustDeskNotFound(format!(
            "File not found: {path}"
        )));
    }
    *state.rustdesk_path.lock().unwrap() = if path.is_empty() {
        rustdesk::detect_path()
    } else {
        Some(path)
    };
    Ok(())
}

#[tauri::command]
pub fn detect_rustdesk() -> Result<String, AppError> {
    rustdesk::detect_path().ok_or_else(|| {
        AppError::RustDeskNotFound("Could not auto-detect RustDesk installation".to_string())
    })
}
