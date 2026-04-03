use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressBook {
    pub version: u32,
    pub root: Folder,
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
