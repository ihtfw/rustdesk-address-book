use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressBook {
    pub version: u32,
    pub root: Folder,
    #[serde(default)]
    pub subscriptions: Vec<Subscription>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TreeNode {
    Folder(Folder),
    Connection(Connection),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub rustdesk_id: String,
    #[serde(default)]
    pub password: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A remote sync subscription. Its `folder_id` matches a top-level Folder in root.children.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub id: Uuid,
    pub name: String,
    pub url: String,
    pub master_key: String,
    /// ID of the corresponding top-level folder in the tree.
    pub folder_id: Uuid,
    /// Last change ID received from the server (cursor for pull).
    #[serde(default)]
    pub last_id: u64,
    /// When we last synced successfully.
    pub last_synced: Option<DateTime<Utc>>,
    /// Node IDs modified locally since last push.
    #[serde(default)]
    pub modified_ids: HashSet<Uuid>,
    /// Node IDs deleted locally since last push.
    #[serde(default)]
    pub deleted_ids: HashSet<Uuid>,
    /// Admin token — set if we created this channel (first push).
    #[serde(default)]
    pub admin_token: Option<String>,
    /// Access token — set if we joined via a shared token.
    #[serde(default)]
    pub access_token: Option<String>,
}

/// Current sync event format version. Bump when making breaking changes.
pub const SYNC_FORMAT_VERSION: u32 = 1;

fn default_sync_version() -> u32 { 1 }

/// A single change event sent to/received from the sync server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEvent {
    /// Format version — reject events with a higher version.
    #[serde(default = "default_sync_version")]
    pub version: u32,
    pub action: SyncAction,
    /// For upsert: the full node (Connection or Folder without children).
    pub node: Option<TreeNode>,
    /// For upsert: which folder this node lives in.
    pub parent_id: Option<Uuid>,
    /// For delete: the node ID to remove.
    pub node_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncAction {
    Upsert,
    Delete,
}

/// Server response for GET /sync/{guid}?after={id}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPullResponse {
    pub changes: Vec<SyncPullEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPullEntry {
    pub id: u64,
    pub data: String, // base64-encoded encrypted blob
}

/// Server response for POST /sync/{guid}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPushResponse {
    pub id: u64,
    /// Returned only on first push (channel creation).
    #[serde(default)]
    pub admin_token: Option<String>,
}

impl AddressBook {
    pub fn new() -> Self {
        Self {
            version: 1,
            root: Folder {
                id: Uuid::new_v4(),
                name: "Root".to_string(),
                description: String::new(),
                children: Vec::new(),
            },
            subscriptions: Vec::new(),
        }
    }

    /// Find a mutable reference to a folder by ID anywhere in the tree.
    pub fn find_folder_mut(&mut self, folder_id: Uuid) -> Option<&mut Folder> {
        find_folder_recursive(&mut self.root, folder_id)
    }

    /// Find a connection by ID anywhere in the tree. Returns a clone.
    pub fn find_connection(&self, connection_id: Uuid) -> Option<Connection> {
        find_connection_recursive(&self.root, connection_id)
    }

    /// Extract a node by ID, returning the node, its parent folder ID, and its index.
    pub fn extract_node_with_info(&mut self, node_id: Uuid) -> Option<(TreeNode, Uuid, usize)> {
        extract_node_with_info_recursive(&mut self.root, node_id)
    }

    /// Move a node to a new parent folder at a given position.
    pub fn move_node(
        &mut self,
        node_id: Uuid,
        new_parent_id: Uuid,
        position: usize,
    ) -> Result<(), String> {
        // First, extract the node
        let node = extract_node_recursive(&mut self.root, node_id)
            .ok_or_else(|| "Node not found".to_string())?;

        // Then, insert into the new parent
        let parent = self
            .find_folder_mut(new_parent_id)
            .ok_or_else(|| "Target folder not found".to_string())?;

        let pos = position.min(parent.children.len());
        parent.children.insert(pos, node);
        Ok(())
    }

    /// Build a new AddressBook containing only the selected node IDs.
    /// If a folder is selected, all its contents are included.
    /// If a connection inside a non-selected folder is selected, the folder
    /// hierarchy is preserved but only with selected connections.
    pub fn extract_selected(&self, selected_ids: &HashSet<Uuid>) -> AddressBook {
        let children = filter_selected(&self.root.children, selected_ids);
        AddressBook {
            version: self.version,
            root: Folder {
                id: Uuid::new_v4(),
                name: "Root".to_string(),
                description: String::new(),
                children,
            },
            subscriptions: Vec::new(),
        }
    }

    /// Merge imported nodes into this address book.
    /// - If a node with the same UUID already exists, update it in place.
    /// - If a node is new, add it to the root.
    pub fn merge_import(&mut self, imported_children: Vec<TreeNode>) {
        // Build a map of all existing node IDs → location for quick lookup
        let existing_ids = collect_all_ids_set(&self.root);

        for child in imported_children {
            let child_id = match &child {
                TreeNode::Folder(f) => f.id,
                TreeNode::Connection(c) => c.id,
            };

            if existing_ids.contains(&child_id) {
                // Update existing node in place
                update_node_recursive(&mut self.root, &child);
            } else {
                // New node — add to root
                self.root.children.push(child);
            }
        }
    }

    /// Find which subscription (if any) a node belongs to.
    /// Checks if the node lives inside any subscription folder.
    pub fn find_subscription_for_node(&self, node_id: Uuid) -> Option<Uuid> {
        for sub in &self.subscriptions {
            // Find the subscription folder in root.children
            for child in &self.root.children {
                if let TreeNode::Folder(f) = child {
                    if f.id == sub.folder_id {
                        if node_is_inside(f, node_id) {
                            return Some(sub.id);
                        }
                    }
                }
            }
        }
        None
    }

    /// Mark a node as modified in its subscription (if it belongs to one).
    pub fn mark_node_modified(&mut self, node_id: Uuid) {
        // First find which subscription this node belongs to
        let sub_id = self.find_subscription_for_node(node_id);
        if let Some(sid) = sub_id {
            if let Some(sub) = self.subscriptions.iter_mut().find(|s| s.id == sid) {
                sub.modified_ids.insert(node_id);
                sub.deleted_ids.remove(&node_id);
            }
        }
    }

    /// Mark a node as deleted in its subscription (if it belongs to one).
    pub fn mark_node_deleted(&mut self, node_id: Uuid) {
        let sub_id = self.find_subscription_for_node(node_id);
        if let Some(sid) = sub_id {
            if let Some(sub) = self.subscriptions.iter_mut().find(|s| s.id == sid) {
                sub.deleted_ids.insert(node_id);
                sub.modified_ids.remove(&node_id);
            }
        }
    }

    /// Apply a sync event to a subscription's folder.
    pub fn apply_sync_event(&mut self, sub_folder_id: Uuid, event: &SyncEvent) {
        match event.action {
            SyncAction::Upsert => {
                if let Some(node) = &event.node {
                    let parent_id = event.parent_id.unwrap_or(sub_folder_id);
                    let node_id = match node {
                        TreeNode::Folder(f) => f.id,
                        TreeNode::Connection(c) => c.id,
                    };
                    // Check if node already exists anywhere in the tree
                    let exists = {
                        let ids = collect_all_ids_set(&self.root);
                        ids.contains(&node_id)
                    };
                    if exists {
                        // Update in place
                        update_node_recursive(&mut self.root, node);
                    } else {
                        // New node — add to the specified parent folder, fall back to subscription folder
                        let target_id = if find_folder_recursive(&mut self.root, parent_id).is_some() {
                            parent_id
                        } else {
                            sub_folder_id
                        };
                        if let Some(folder) = find_folder_recursive(&mut self.root, target_id) {
                            folder.children.push(node.clone());
                        }
                    }
                }
            }
            SyncAction::Delete => {
                if let Some(node_id) = event.node_id {
                    extract_node_recursive(&mut self.root, node_id);
                }
            }
        }
    }
}

fn find_folder_recursive(folder: &mut Folder, target_id: Uuid) -> Option<&mut Folder> {
    if folder.id == target_id {
        return Some(folder);
    }
    for child in &mut folder.children {
        if let TreeNode::Folder(ref mut f) = child {
            if let Some(found) = find_folder_recursive(f, target_id) {
                return Some(found);
            }
        }
    }
    None
}

/// Check if a node with the given ID exists anywhere inside a folder (recursively).
fn node_is_inside(folder: &Folder, target_id: Uuid) -> bool {
    for child in &folder.children {
        match child {
            TreeNode::Folder(f) => {
                if f.id == target_id || node_is_inside(f, target_id) {
                    return true;
                }
            }
            TreeNode::Connection(c) => {
                if c.id == target_id {
                    return true;
                }
            }
        }
    }
    false
}

fn find_connection_recursive(folder: &Folder, target_id: Uuid) -> Option<Connection> {
    for child in &folder.children {
        match child {
            TreeNode::Connection(c) if c.id == target_id => return Some(c.clone()),
            TreeNode::Folder(f) => {
                if let Some(found) = find_connection_recursive(f, target_id) {
                    return Some(found);
                }
            }
            _ => {}
        }
    }
    None
}

fn extract_node_recursive(folder: &mut Folder, target_id: Uuid) -> Option<TreeNode> {
    let pos = folder.children.iter().position(|child| match child {
        TreeNode::Folder(f) => f.id == target_id,
        TreeNode::Connection(c) => c.id == target_id,
    });
    if let Some(idx) = pos {
        return Some(folder.children.remove(idx));
    }
    for child in &mut folder.children {
        if let TreeNode::Folder(ref mut f) = child {
            if let Some(node) = extract_node_recursive(f, target_id) {
                return Some(node);
            }
        }
    }
    None
}

fn extract_node_with_info_recursive(
    folder: &mut Folder,
    target_id: Uuid,
) -> Option<(TreeNode, Uuid, usize)> {
    let pos = folder.children.iter().position(|child| match child {
        TreeNode::Folder(f) => f.id == target_id,
        TreeNode::Connection(c) => c.id == target_id,
    });
    if let Some(idx) = pos {
        let node = folder.children.remove(idx);
        return Some((node, folder.id, idx));
    }
    for child in &mut folder.children {
        if let TreeNode::Folder(ref mut f) = child {
            if let Some(result) = extract_node_with_info_recursive(f, target_id) {
                return Some(result);
            }
        }
    }
    None
}

/// Recursively filter tree nodes, keeping selected folders (with all contents)
/// and selected connections. Non-selected folders are kept only if they contain
/// selected descendants, but with only those descendants.
fn filter_selected(nodes: &[TreeNode], selected: &HashSet<Uuid>) -> Vec<TreeNode> {
    let mut result = Vec::new();
    for node in nodes {
        match node {
            TreeNode::Folder(f) => {
                if selected.contains(&f.id) {
                    // Folder selected → include with all contents
                    result.push(TreeNode::Folder(f.clone()));
                } else {
                    // Check if any descendant is selected
                    let children = filter_selected(&f.children, selected);
                    if !children.is_empty() {
                        result.push(TreeNode::Folder(Folder {
                            id: f.id,
                            name: f.name.clone(),
                            description: f.description.clone(),
                            children,
                        }));
                    }
                }
            }
            TreeNode::Connection(c) => {
                if selected.contains(&c.id) {
                    result.push(TreeNode::Connection(c.clone()));
                }
            }
        }
    }
    result
}

/// Collect all node IDs in a folder tree into a HashSet.
fn collect_all_ids_set(folder: &Folder) -> HashSet<Uuid> {
    let mut ids = HashSet::new();
    ids.insert(folder.id);
    for child in &folder.children {
        match child {
            TreeNode::Folder(f) => {
                ids.extend(collect_all_ids_set(f));
            }
            TreeNode::Connection(c) => {
                ids.insert(c.id);
            }
        }
    }
    ids
}

/// Recursively find and update a node by its UUID.
/// For connections: update all fields.
/// For folders: update name/description, then recursively merge children.
fn update_node_recursive(folder: &mut Folder, import_node: &TreeNode) {
    match import_node {
        TreeNode::Connection(import_conn) => {
            // Look for matching connection in this folder's children
            for child in &mut folder.children {
                if let TreeNode::Connection(ref mut c) = child {
                    if c.id == import_conn.id {
                        c.name = import_conn.name.clone();
                        c.description = import_conn.description.clone();
                        c.rustdesk_id = import_conn.rustdesk_id.clone();
                        c.password = import_conn.password.clone();
                        c.updated_at = import_conn.updated_at;
                        return;
                    }
                }
            }
            // Not found at this level — recurse into subfolders
            for child in &mut folder.children {
                if let TreeNode::Folder(ref mut f) = child {
                    update_node_recursive(f, import_node);
                }
            }
        }
        TreeNode::Folder(import_folder) => {
            // Look for matching folder
            for child in &mut folder.children {
                if let TreeNode::Folder(ref mut f) = child {
                    if f.id == import_folder.id {
                        f.name = import_folder.name.clone();
                        f.description = import_folder.description.clone();
                        // Recursively merge children of this folder
                        let existing_ids = collect_all_ids_set(f);
                        for import_child in &import_folder.children {
                            let import_child_id = match import_child {
                                TreeNode::Folder(ff) => ff.id,
                                TreeNode::Connection(cc) => cc.id,
                            };
                            if existing_ids.contains(&import_child_id) {
                                update_node_recursive(f, import_child);
                            } else {
                                f.children.push(import_child.clone());
                            }
                        }
                        return;
                    }
                }
            }
            // Not found at this level — recurse into subfolders
            for child in &mut folder.children {
                if let TreeNode::Folder(ref mut f) = child {
                    update_node_recursive(f, import_node);
                }
            }
        }
    }
}
