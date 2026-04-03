use std::collections::HashSet;
use std::sync::Mutex;

use chrono::Utc;
use tracing::{info, warn};
use uuid::Uuid;

use crate::crypto;
use crate::errors::AppError;
use crate::models::{AddressBook, Connection, Folder, Subscription, SyncAction, SyncEvent, SyncPullResponse, SyncPushResponse, TreeNode, SYNC_FORMAT_VERSION};
use crate::rustdesk;
use crate::storage;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

pub struct DeletedNode {
    pub node: TreeNode,
    pub parent_id: Uuid,
    pub position: usize,
}

/// Application state held in Tauri's managed state.
pub struct AppState {
    pub address_book: Mutex<Option<AddressBook>>,
    pub master_password: Mutex<Option<String>>,
    pub rustdesk_path: Mutex<Option<String>>,
    pub last_deleted: Mutex<Option<DeletedNode>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            address_book: Mutex::new(None),
            master_password: Mutex::new(None),
            rustdesk_path: Mutex::new(None),
            last_deleted: Mutex::new(None),
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
pub fn get_recent_paths() -> Result<Vec<String>, AppError> {
    storage::get_recent_paths()
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
    parent_id: String,
    name: String,
    description: String,
) -> Result<Folder, AppError> {
    let parent_uuid = Uuid::parse_str(&parent_id)
        .map_err(|e| AppError::General(format!("Invalid parent ID: {}", e)))?;
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    let new_folder = Folder {
        id: Uuid::new_v4(),
        name,
        description,
        children: Vec::new(),
    };

    let parent = book
        .find_folder_mut(parent_uuid)
        .ok_or_else(|| AppError::General("Parent folder not found".to_string()))?;
    let result = new_folder.clone();
    parent.children.push(TreeNode::Folder(new_folder));

    book.mark_node_modified(result.id);

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(result)
}

#[tauri::command]
pub fn add_connection(
    state: tauri::State<'_, AppState>,
    parent_id: String,
    name: String,
    description: String,
    rustdesk_id: String,
    password: String,
) -> Result<Connection, AppError> {
    let parent_uuid = Uuid::parse_str(&parent_id)
        .map_err(|e| AppError::General(format!("Invalid parent ID: {}", e)))?;
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
        .find_folder_mut(parent_uuid)
        .ok_or_else(|| AppError::General("Parent folder not found".to_string()))?;
    let result = new_conn.clone();
    parent.children.push(TreeNode::Connection(new_conn));

    book.mark_node_modified(result.id);

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(result)
}

#[tauri::command]
pub fn update_folder(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
    description: String,
) -> Result<Folder, AppError> {
    let uuid = Uuid::parse_str(&id)
        .map_err(|e| AppError::General(format!("Invalid folder ID: {}", e)))?;
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    let folder = book
        .find_folder_mut(uuid)
        .ok_or_else(|| AppError::General("Folder not found".to_string()))?;
    folder.name = name;
    folder.description = description;
    let result = folder.clone();

    book.mark_node_modified(uuid);

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
    id: String,
    name: String,
    description: String,
    rustdesk_id: String,
    password: String,
) -> Result<Connection, AppError> {
    let uuid = Uuid::parse_str(&id)
        .map_err(|e| AppError::General(format!("Invalid connection ID: {}", e)))?;
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    let conn = find_connection_mut(&mut book.root, uuid)
        .ok_or_else(|| AppError::General("Connection not found".to_string()))?;
    conn.name = name;
    conn.description = description;
    conn.rustdesk_id = rustdesk_id;
    conn.password = password;
    conn.updated_at = Utc::now();
    let result = conn.clone();

    book.mark_node_modified(uuid);

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(result)
}

#[tauri::command]
pub fn delete_node(state: tauri::State<'_, AppState>, id: String) -> Result<(), AppError> {
    let uuid = Uuid::parse_str(&id)
        .map_err(|e| AppError::General(format!("Invalid node ID: {}", e)))?;
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    // Mark as deleted in subscription before extracting
    book.mark_node_deleted(uuid);

    let (node, parent_id, position) = book
        .extract_node_with_info(uuid)
        .ok_or_else(|| AppError::General("Node not found".to_string()))?;

    // Store for undo
    *state.last_deleted.lock().unwrap() = Some(DeletedNode {
        node,
        parent_id,
        position,
    });

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(())
}

#[tauri::command]
pub fn undo_delete(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let deleted = state
        .last_deleted
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| AppError::General("Nothing to undo".to_string()))?;

    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    let parent = book
        .find_folder_mut(deleted.parent_id)
        .ok_or_else(|| AppError::General("Parent folder no longer exists".to_string()))?;

    let pos = deleted.position.min(parent.children.len());
    parent.children.insert(pos, deleted.node);

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

    book.mark_node_modified(node_uuid);

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

#[tauri::command]
pub fn get_auto_update() -> Result<bool, AppError> {
    let config = storage::load_config()?;
    Ok(config.auto_update)
}

#[tauri::command]
pub fn set_auto_update(enabled: bool) -> Result<(), AppError> {
    let mut config = storage::load_config()?;
    config.auto_update = enabled;
    storage::save_config(&config)
}

#[tauri::command]
pub fn get_language() -> Result<String, AppError> {
    let config = storage::load_config()?;
    Ok(config.language)
}

#[tauri::command]
pub fn set_language(lang: String) -> Result<(), AppError> {
    let mut config = storage::load_config()?;
    config.language = lang;
    storage::save_config(&config)
}

// ─── Export / Import Commands ────────────────────────────────────

#[tauri::command]
pub fn export_nodes(
    state: tauri::State<'_, AppState>,
    node_ids: Vec<String>,
    password: String,
    file_path: String,
) -> Result<(), AppError> {
    let book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_ref().ok_or(AppError::Locked)?;

    let ids: HashSet<Uuid> = node_ids
        .iter()
        .map(|id| Uuid::parse_str(id))
        .collect::<Result<_, _>>()
        .map_err(|e| AppError::General(format!("Invalid node ID: {}", e)))?;

    let export_book = book.extract_selected(&ids);
    drop(book_lock);

    // Use provided password, or fall back to current master password
    let actual_password = if password.is_empty() {
        let pw = state.master_password.lock().unwrap();
        pw.as_ref().ok_or(AppError::Locked)?.clone()
    } else {
        password
    };

    let plaintext =
        serde_json::to_vec(&export_book).map_err(|e| AppError::Storage(e.to_string()))?;
    let blob = crypto::encrypt(&plaintext, &actual_password)?;

    let path = std::path::PathBuf::from(&file_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Storage(e.to_string()))?;
    }
    std::fs::write(&path, &blob).map_err(|e| AppError::Storage(e.to_string()))?;

    Ok(())
}

#[tauri::command]
pub fn import_nodes(
    state: tauri::State<'_, AppState>,
    file_path: String,
    password: String,
) -> Result<Folder, AppError> {
    // Use provided password, or fall back to current master password
    let actual_password = if password.is_empty() {
        let pw = state.master_password.lock().unwrap();
        pw.as_ref().ok_or(AppError::Locked)?.clone()
    } else {
        password
    };

    // Decrypt the import file
    let blob =
        std::fs::read(&file_path).map_err(|e| AppError::Storage(e.to_string()))?;
    let plaintext = crypto::decrypt(&blob, &actual_password)?;
    let import_book: AddressBook =
        serde_json::from_slice(&plaintext).map_err(|e| AppError::Storage(e.to_string()))?;

    // Merge imported children into current book (update existing by UUID, add new)
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    book.merge_import(import_book.root.children);
    let result = book.root.clone();

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(result)
}

#[tauri::command]
pub fn try_import(
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<bool, AppError> {
    // Try to decrypt using current master password
    let pw_lock = state.master_password.lock().unwrap();
    let password = pw_lock.as_ref().ok_or(AppError::Locked)?.clone();
    drop(pw_lock);

    let blob =
        std::fs::read(&file_path).map_err(|e| AppError::Storage(e.to_string()))?;
    match crypto::decrypt(&blob, &password) {
        Ok(_) => Ok(true),  // Current password works
        Err(_) => Ok(false), // Need a different password
    }
}

// ─── Subscription CRUD Commands ──────────────────────────────────

#[tauri::command]
pub fn get_subscriptions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Subscription>, AppError> {
    let book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_ref().ok_or(AppError::Locked)?;
    Ok(book.subscriptions.clone())
}

#[tauri::command]
pub fn add_subscription(
    state: tauri::State<'_, AppState>,
    name: String,
    url: String,
    master_key: String,
    access_token: Option<String>,
) -> Result<Subscription, AppError> {
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    let folder_id = Uuid::new_v4();
    let sub = Subscription {
        id: Uuid::new_v4(),
        name: name.clone(),
        url,
        master_key,
        folder_id,
        last_id: 0,
        last_synced: None,
        modified_ids: HashSet::new(),
        deleted_ids: HashSet::new(),
        admin_token: None,
        access_token,
        permissions: None,
    };

    // Create the corresponding top-level folder
    let folder = Folder {
        id: folder_id,
        name,
        description: String::new(),
        children: Vec::new(),
    };
    book.root.children.push(TreeNode::Folder(folder));
    book.subscriptions.push(sub.clone());

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(sub)
}

#[tauri::command]
pub fn update_subscription(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
    url: String,
    master_key: String,
) -> Result<Subscription, AppError> {
    let sub_uuid = Uuid::parse_str(&id)
        .map_err(|e| AppError::General(format!("Invalid subscription ID: {}", e)))?;
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    let sub = book.subscriptions.iter_mut().find(|s| s.id == sub_uuid)
        .ok_or_else(|| AppError::General("Subscription not found".to_string()))?;
    sub.name = name.clone();
    sub.url = url;
    sub.master_key = master_key;
    let result = sub.clone();

    // Also update the folder name
    if let Some(folder) = book.find_folder_mut(result.folder_id) {
        folder.name = name;
    }

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(result)
}

#[tauri::command]
pub fn remove_subscription(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let sub_uuid = Uuid::parse_str(&id)
        .map_err(|e| AppError::General(format!("Invalid subscription ID: {}", e)))?;
    let mut book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_mut().ok_or(AppError::Locked)?;

    // Find and remove the subscription
    let folder_id = {
        let idx = book.subscriptions.iter().position(|s| s.id == sub_uuid)
            .ok_or_else(|| AppError::General("Subscription not found".to_string()))?;
        let sub = book.subscriptions.remove(idx);
        sub.folder_id
    };

    // Remove the corresponding folder from root.children
    book.root.children.retain(|child| {
        match child {
            TreeNode::Folder(f) => f.id != folder_id,
            _ => true,
        }
    });

    drop(book_lock);
    get_book_and_save(&state)?;
    Ok(())
}

// ─── Token Management Commands ──────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AccessTokenInfo {
    pub id: u64,
    pub label: String,
    pub permissions: String,
    pub created_at: String,
    pub revoked: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CreatedToken {
    pub id: u64,
    pub token: String,
    pub label: String,
    pub permissions: String,
}

fn get_sub_url_and_admin_token(state: &AppState, subscription_id: &str) -> Result<(String, String), AppError> {
    let sub_uuid = Uuid::parse_str(subscription_id)
        .map_err(|e| AppError::General(format!("Invalid subscription ID: {}", e)))?;
    let book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_ref().ok_or(AppError::Locked)?;
    let sub = book.subscriptions.iter().find(|s| s.id == sub_uuid)
        .ok_or_else(|| AppError::General("Subscription not found".to_string()))?;
    let admin_token = sub.admin_token.clone()
        .ok_or_else(|| AppError::General("Not an admin of this subscription".to_string()))?;
    Ok((sub.url.clone(), admin_token))
}

#[tauri::command]
pub async fn list_access_tokens(
    state: tauri::State<'_, AppState>,
    subscription_id: String,
) -> Result<Vec<AccessTokenInfo>, AppError> {
    let (url, admin_token) = get_sub_url_and_admin_token(&state, &subscription_id)?;

    let client = reqwest::Client::new();
    let response = client.get(format!("{}/tokens", url))
        .header("Authorization", format!("Bearer {}", admin_token))
        .send()
        .await
        .map_err(|e| AppError::General(format!("Request failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::General(format!("Server returned {}", response.status())));
    }

    #[derive(serde::Deserialize)]
    struct Resp { tokens: Vec<AccessTokenInfo> }
    let resp: Resp = response.json().await
        .map_err(|e| AppError::General(format!("Invalid response: {}", e)))?;
    Ok(resp.tokens)
}

#[tauri::command]
pub async fn create_access_token(
    state: tauri::State<'_, AppState>,
    subscription_id: String,
    label: String,
    permissions: String,
) -> Result<CreatedToken, AppError> {
    let (url, admin_token) = get_sub_url_and_admin_token(&state, &subscription_id)?;

    let client = reqwest::Client::new();
    let response = client.post(format!("{}/tokens", url))
        .header("Authorization", format!("Bearer {}", admin_token))
        .json(&serde_json::json!({ "label": label, "permissions": permissions }))
        .send()
        .await
        .map_err(|e| AppError::General(format!("Request failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::General(format!("Server returned {}", response.status())));
    }

    let token: CreatedToken = response.json().await
        .map_err(|e| AppError::General(format!("Invalid response: {}", e)))?;
    Ok(token)
}

#[tauri::command]
pub async fn revoke_access_token(
    state: tauri::State<'_, AppState>,
    subscription_id: String,
    token_id: u64,
) -> Result<(), AppError> {
    let (url, admin_token) = get_sub_url_and_admin_token(&state, &subscription_id)?;

    let client = reqwest::Client::new();
    let response = client.delete(format!("{}/tokens/{}", url, token_id))
        .header("Authorization", format!("Bearer {}", admin_token))
        .send()
        .await
        .map_err(|e| AppError::General(format!("Request failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::General(format!("Server returned {}", response.status())));
    }

    Ok(())
}

#[tauri::command]
pub async fn check_subscription_permissions(
    state: tauri::State<'_, AppState>,
    subscription_id: String,
) -> Result<String, AppError> {
    let sub_uuid = Uuid::parse_str(&subscription_id)
        .map_err(|e| AppError::General(format!("Invalid subscription ID: {}", e)))?;

    let (url, auth_token) = {
        let book_lock = state.address_book.lock().unwrap();
        let book = book_lock.as_ref().ok_or(AppError::Locked)?;
        let sub = book.subscriptions.iter().find(|s| s.id == sub_uuid)
            .ok_or_else(|| AppError::General("Subscription not found".to_string()))?;
        (sub.url.clone(), sub.admin_token.clone().or_else(|| sub.access_token.clone()))
    };

    let me_url = format!("{}/me", url);
    let client = reqwest::Client::new();
    let mut req = client.get(&me_url);
    if let Some(token) = &auth_token {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    let response = req.send().await
        .map_err(|e| AppError::General(format!("Request failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::General(format!("Server returned {}", response.status())));
    }

    #[derive(serde::Deserialize)]
    struct MeResp { permissions: String }
    let resp: MeResp = response.json().await
        .map_err(|e| AppError::General(format!("Invalid response: {}", e)))?;

    // Store permissions in subscription
    {
        let mut book_lock = state.address_book.lock().unwrap();
        let book = book_lock.as_mut().ok_or(AppError::Locked)?;
        if let Some(sub) = book.subscriptions.iter_mut().find(|s| s.id == sub_uuid) {
            sub.permissions = Some(resp.permissions.clone());
        }
    }
    get_book_and_save(&state)?;

    Ok(resp.permissions)
}

// ─── Sync Commands ──────────────────────────────────────────────

/// Helper: collect all nodes inside a folder as a flat list of (node, parent_id) pairs.
fn collect_nodes_flat(folder: &Folder) -> Vec<(TreeNode, Uuid)> {
    let mut result = Vec::new();
    for child in &folder.children {
        match child {
            TreeNode::Folder(f) => {
                // Add the folder itself (without children, for the event)
                let folder_without_children = TreeNode::Folder(Folder {
                    id: f.id,
                    name: f.name.clone(),
                    description: f.description.clone(),
                    children: Vec::new(),
                });
                result.push((folder_without_children, folder.id));
                // Recurse into children
                result.extend(collect_nodes_flat(f));
            }
            TreeNode::Connection(c) => {
                result.push((TreeNode::Connection(c.clone()), folder.id));
            }
        }
    }
    result
}

// ── Private sync helpers (no save) ───────────────────────────────

async fn do_sync_pull(
    state: &AppState,
    subscription_id: &str,
    client: &reqwest::Client,
) -> Result<Folder, AppError> {
    let total_start = std::time::Instant::now();
    let sub_uuid = Uuid::parse_str(subscription_id)
        .map_err(|e| AppError::General(format!("Invalid subscription ID: {}", e)))?;

    // Get subscription info
    let (url, master_key, folder_id, last_id, auth_token) = {
        let book_lock = state.address_book.lock().unwrap();
        let book = book_lock.as_ref().ok_or(AppError::Locked)?;
        let sub = book.subscriptions.iter().find(|s| s.id == sub_uuid)
            .ok_or_else(|| AppError::General("Subscription not found".to_string()))?;
        (sub.url.clone(), sub.master_key.clone(), sub.folder_id, sub.last_id,
         sub.admin_token.clone().or_else(|| sub.access_token.clone()))
    };

    info!(sub = %subscription_id, last_id = last_id, "sync_pull: starting");

    // GET changes from server
    let pull_url = format!("{}?after={}", url, last_id);
    let http_start = std::time::Instant::now();
    let mut req = client.get(&pull_url);
    if let Some(token) = &auth_token {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    let response = req
        .send()
        .await
        .map_err(|e| AppError::General(format!("Sync pull failed: {}", e)))?;
    let http_elapsed = http_start.elapsed();

    if !response.status().is_success() {
        let status = response.status();
        warn!(sub = %subscription_id, status = %status, "sync_pull: server error");

        // On 401 Unauthorized (token revoked/invalid): clear subscription data
        if status == reqwest::StatusCode::UNAUTHORIZED {
            warn!(sub = %subscription_id, "sync_pull: 401 — clearing subscription tree and resetting cursor");
            let mut book_lock = state.address_book.lock().unwrap();
            if let Some(book) = book_lock.as_mut() {
                // Clear the folder's children
                if let Some(folder) = book.root.children.iter_mut().find_map(|c| match c {
                    TreeNode::Folder(f) if f.id == folder_id => Some(f),
                    _ => None,
                }) {
                    folder.children.clear();
                }
                // Reset subscription state
                if let Some(sub) = book.subscriptions.iter_mut().find(|s| s.id == sub_uuid) {
                    sub.last_id = 0;
                    sub.modified_ids.clear();
                    sub.deleted_ids.clear();
                    sub.permissions = Some("ro".to_string());
                    sub.access_token = None;
                }
            }
            drop(book_lock);
            let _ = get_book_and_save(state);
        }

        return Err(AppError::General(format!("Server returned {}", status)));
    }

    let pull_response: SyncPullResponse = response.json()
        .await
        .map_err(|e| AppError::General(format!("Invalid server response: {}", e)))?;

    info!(sub = %subscription_id, changes = pull_response.changes.len(), http_ms = http_elapsed.as_millis(), "sync_pull: received changes");

    // Apply each change
    let mut new_last_id = last_id;
    {
        let apply_start = std::time::Instant::now();
        let mut book_lock = state.address_book.lock().unwrap();
        let book = book_lock.as_mut().ok_or(AppError::Locked)?;

        // Cache derived keys by salt to avoid repeated KDF (~250ms each)
        let mut key_cache: std::collections::HashMap<String, [u8; 32]> = std::collections::HashMap::new();

        for entry in &pull_response.changes {
            // Decode and decrypt the change
            let blob = BASE64.decode(&entry.data)
                .map_err(|e| AppError::General(format!("Invalid base64: {}", e)))?;

            let salt = crypto::extract_salt(&blob)?;
            let key = if let Some(k) = key_cache.get(&salt) {
                *k
            } else {
                let k = crypto::derive_key_with_salt(&master_key, &salt)?;
                key_cache.insert(salt, k);
                k
            };

            let plaintext = crypto::decrypt_with_key(&blob, &key)?;
            let event: SyncEvent = serde_json::from_slice(&plaintext)
                .map_err(|e| AppError::General(format!("Invalid sync event: {}", e)))?;

            if event.version > SYNC_FORMAT_VERSION {
                warn!(sub = %subscription_id, event_version = event.version, supported = SYNC_FORMAT_VERSION, "sync_pull: unsupported version");
                return Err(AppError::General(format!(
                    "Sync event format version {} is newer than supported ({}). Please update the application.",
                    event.version, SYNC_FORMAT_VERSION
                )));
            }

            book.apply_sync_event(folder_id, &event);

            if entry.id > new_last_id {
                new_last_id = entry.id;
            }
        }

        // Update subscription cursor and last_synced
        if let Some(sub) = book.subscriptions.iter_mut().find(|s| s.id == sub_uuid) {
            sub.last_id = new_last_id;
            sub.last_synced = Some(Utc::now());
        }

        let apply_elapsed = apply_start.elapsed();
        info!(sub = %subscription_id, apply_ms = apply_elapsed.as_millis(), "sync_pull: applied changes");
    }

    let total_elapsed = total_start.elapsed();
    info!(sub = %subscription_id, total_ms = total_elapsed.as_millis(), "sync_pull: done (no save)");

    // Return the updated folder
    let book_lock = state.address_book.lock().unwrap();
    let book = book_lock.as_ref().ok_or(AppError::Locked)?;
    let folder = book.root.children.iter()
        .find_map(|c| match c {
            TreeNode::Folder(f) if f.id == folder_id => Some(f.clone()),
            _ => None,
        })
        .ok_or_else(|| AppError::General("Subscription folder not found".to_string()))?;
    Ok(folder)
}

async fn do_sync_push(
    state: &AppState,
    subscription_id: &str,
    client: &reqwest::Client,
) -> Result<(), AppError> {
    let total_start = std::time::Instant::now();
    let sub_uuid = Uuid::parse_str(subscription_id)
        .map_err(|e| AppError::General(format!("Invalid subscription ID: {}", e)))?;

    // Collect data needed for push
    let (url, master_key, modified_ids, deleted_ids, folder_id, auth_token) = {
        let book_lock = state.address_book.lock().unwrap();
        let book = book_lock.as_ref().ok_or(AppError::Locked)?;
        let sub = book.subscriptions.iter().find(|s| s.id == sub_uuid)
            .ok_or_else(|| AppError::General("Subscription not found".to_string()))?;
        (
            sub.url.clone(),
            sub.master_key.clone(),
            sub.modified_ids.clone(),
            sub.deleted_ids.clone(),
            sub.folder_id,
            sub.admin_token.clone().or_else(|| sub.access_token.clone()),
        )
    };

    let mut new_last_id = 0u64;

    // Collect events to send (outside the lock)
    let events: Vec<SyncEvent>;
    {
        let book_lock = state.address_book.lock().unwrap();
        let book = book_lock.as_ref().ok_or(AppError::Locked)?;

        let sub_folder = book.root.children.iter()
            .find_map(|c| match c {
                TreeNode::Folder(f) if f.id == folder_id => Some(f),
                _ => None,
            })
            .ok_or_else(|| AppError::General("Subscription folder not found".to_string()))?;

        let all_nodes = collect_nodes_flat(sub_folder);
        let mut ev = Vec::new();

        for (node, parent_id) in &all_nodes {
            let node_id = match node {
                TreeNode::Folder(f) => f.id,
                TreeNode::Connection(c) => c.id,
            };
            if modified_ids.contains(&node_id) {
                ev.push(SyncEvent {
                    version: SYNC_FORMAT_VERSION,
                    action: SyncAction::Upsert,
                    node: Some(node.clone()),
                    parent_id: Some(*parent_id),
                    node_id: None,
                });
            }
        }

        for del_id in &deleted_ids {
            ev.push(SyncEvent {
                version: SYNC_FORMAT_VERSION,
                action: SyncAction::Delete,
                node: None,
                parent_id: None,
                node_id: Some(*del_id),
            });
        }

        events = ev;
    }

    info!(sub = %subscription_id, events = events.len(), modified = modified_ids.len(), deleted = deleted_ids.len(), "sync_push: sending events");

    let mut received_admin_token: Option<String> = None;

    if !events.is_empty() {
        // Derive key once and reuse for all events (avoids N × 250ms KDF)
        let (sync_key, sync_salt) = crypto::make_key(&master_key)?;

        // Send each event to server (outside the lock)
        for (i, event) in events.iter().enumerate() {
            let plaintext = serde_json::to_vec(event)
                .map_err(|e| AppError::General(format!("Serialization failed: {}", e)))?;
            let encrypt_start = std::time::Instant::now();
            let encrypted = crypto::encrypt_with_key(&plaintext, &sync_key, &sync_salt)?;
            let encrypt_elapsed = encrypt_start.elapsed();
            let encoded = BASE64.encode(&encrypted);

            let http_start = std::time::Instant::now();
            let mut req = client.post(&url)
                .json(&serde_json::json!({ "data": encoded }));
            if let Some(token) = &auth_token {
                req = req.header("Authorization", format!("Bearer {}", token));
            }
            let response = req
                .send()
                .await
                .map_err(|e| AppError::General(format!("Sync push failed: {}", e)))?;
            let http_elapsed = http_start.elapsed();

            if !response.status().is_success() {
                warn!(sub = %subscription_id, status = %response.status(), event_idx = i, "sync_push: server error");
                return Err(AppError::General(format!("Server returned {}", response.status())));
            }

            let push_response: SyncPushResponse = response.json()
                .await
                .map_err(|e| AppError::General(format!("Invalid server response: {}", e)))?;
            if push_response.id > new_last_id {
                new_last_id = push_response.id;
            }
            if let Some(at) = push_response.admin_token {
                info!(sub = %subscription_id, "sync_push: received admin_token (channel created)");
                received_admin_token = Some(at);
            }

            info!(sub = %subscription_id, event_idx = i, encrypt_ms = encrypt_elapsed.as_millis(), http_ms = http_elapsed.as_millis(), data_bytes = encoded.len(), "sync_push: sent event");
        }
    } else if auth_token.is_none() {
        // No events, but no token yet — send an empty push to create the channel and get admin_token
        info!(sub = %subscription_id, "sync_push: no events, sending init push for channel creation");
        let response = client.post(&url)
            .json(&serde_json::json!({ "data": "" }))
            .send()
            .await
            .map_err(|e| AppError::General(format!("Sync push failed: {}", e)))?;

        if !response.status().is_success() {
            warn!(sub = %subscription_id, status = %response.status(), "sync_push: init push server error");
            return Err(AppError::General(format!("Server returned {}", response.status())));
        }

        let push_response: SyncPushResponse = response.json()
            .await
            .map_err(|e| AppError::General(format!("Invalid server response: {}", e)))?;
        if let Some(at) = push_response.admin_token {
            info!(sub = %subscription_id, "sync_push: received admin_token (channel created)");
            received_admin_token = Some(at);
        }
    }

    // Clear dirty state and update cursor
    {
        let mut book_lock = state.address_book.lock().unwrap();
        let book = book_lock.as_mut().ok_or(AppError::Locked)?;
        if let Some(sub) = book.subscriptions.iter_mut().find(|s| s.id == sub_uuid) {
            sub.modified_ids.clear();
            sub.deleted_ids.clear();
            if new_last_id > sub.last_id {
                sub.last_id = new_last_id;
            }
            sub.last_synced = Some(Utc::now());
            if let Some(at) = received_admin_token {
                sub.admin_token = Some(at);
            }
        }
    }

    let total_elapsed = total_start.elapsed();
    info!(sub = %subscription_id, total_ms = total_elapsed.as_millis(), "sync_push: done (no save)");
    Ok(())
}

// ── Tauri sync commands ─────────────────────────────────────────

#[tauri::command]
pub async fn sync_pull(
    state: tauri::State<'_, AppState>,
    subscription_id: String,
) -> Result<Folder, AppError> {
    let client = reqwest::Client::new();
    let folder = do_sync_pull(&state, &subscription_id, &client).await?;
    get_book_and_save(&state)?;
    Ok(folder)
}

#[tauri::command]
pub async fn sync_push(
    state: tauri::State<'_, AppState>,
    subscription_id: String,
) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    do_sync_push(&state, &subscription_id, &client).await?;
    get_book_and_save(&state)?;
    Ok(())
}

#[tauri::command]
pub async fn sync_subscription(
    state: tauri::State<'_, AppState>,
    subscription_id: String,
) -> Result<Folder, AppError> {
    let total_start = std::time::Instant::now();
    let client = reqwest::Client::new();

    // Pull first, then push — single save at the end
    let folder = do_sync_pull(&state, &subscription_id, &client).await?;
    do_sync_push(&state, &subscription_id, &client).await?;

    let save_start = std::time::Instant::now();
    get_book_and_save(&state)?;
    let save_elapsed = save_start.elapsed();

    let total_elapsed = total_start.elapsed();
    info!(sub = %subscription_id, save_ms = save_elapsed.as_millis(), total_ms = total_elapsed.as_millis(), "sync: done");

    Ok(folder)
}
