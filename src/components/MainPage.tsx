import { useState, useRef, useEffect, useCallback } from "react";
import type { Folder, TreeNode, SelectedItem, Connection } from "../types";
import * as api from "../api";
import TreeView from "../components/TreeView";
import ConnectionForm from "../components/ConnectionForm";
import FolderForm from "../components/FolderForm";
import Settings from "../components/Settings";

interface ContextMenu {
  x: number;
  y: number;
  node: TreeNode;
  parentId: string;
}

interface Props {
  initialRoot: Folder;
  onLock: () => void;
}

type EditMode =
  | null
  | { kind: "new-folder"; parentId: string }
  | { kind: "edit-folder"; folder: Folder }
  | { kind: "new-connection"; parentId: string }
  | { kind: "edit-connection"; connection: Connection };

export default function MainPage({ initialRoot, onLock }: Props) {
  const [root, setRoot] = useState<Folder>(initialRoot);
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const refreshTree = useCallback(async () => {
    try {
      const tree = await api.getTree();
      setRoot(tree);
    } catch (err: unknown) {
      setError(String(err));
    }
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const handleSelect = (item: SelectedItem) => {
    setSelected(item);
    setEditMode(null);
  };

  const handleConnect = async (connectionId: string) => {
    console.log("handleConnect called with:", connectionId);
    try {
      setError("");
      const result = await api.connectToHost(connectionId);
      console.log("connectToHost succeeded:", result);
    } catch (err: unknown) {
      console.error("connectToHost error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Unknown error connecting");
    }
  };

  const handleContextMenu = (
    e: React.MouseEvent,
    node: TreeNode,
    parentId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node, parentId });
  };

  const handleRootContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node: { ...root, type: "Folder" } as any,
      parentId: root.id,
    });
  };

  const handleDrop = async (
    nodeId: string,
    newParentId: string,
    position: number,
  ) => {
    console.log("handleDrop:", { nodeId, newParentId, position });
    try {
      await api.moveNode(nodeId, newParentId, position);
      await refreshTree();
    } catch (err: unknown) {
      console.error("moveNode error:", err);
      setError(String(err));
    }
  };

  // ── CRUD handlers ──

  const handleSaveFolder = async (data: {
    name: string;
    description: string;
  }) => {
    try {
      setError("");
      if (editMode?.kind === "new-folder") {
        const folder = await api.addFolder(
          editMode.parentId,
          data.name,
          data.description,
        );
        setSelected({ kind: "folder", data: folder });
      } else if (editMode?.kind === "edit-folder") {
        const folder = await api.updateFolder(
          editMode.folder.id,
          data.name,
          data.description,
        );
        setSelected({ kind: "folder", data: folder });
      }
      await refreshTree();
      setEditMode(null);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleSaveConnection = async (data: {
    name: string;
    description: string;
    rustdesk_id: string;
    password: string;
  }) => {
    try {
      setError("");
      if (editMode?.kind === "new-connection") {
        const conn = await api.addConnection(
          editMode.parentId,
          data.name,
          data.description,
          data.rustdesk_id,
          data.password,
        );
        setSelected({ kind: "connection", data: conn });
      } else if (editMode?.kind === "edit-connection") {
        const conn = await api.updateConnection(
          editMode.connection.id,
          data.name,
          data.description,
          data.rustdesk_id,
          data.password,
        );
        setSelected({ kind: "connection", data: conn });
      }
      await refreshTree();
      setEditMode(null);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setError("");
      await api.deleteNode(id);
      await refreshTree();
      setSelected(null);
      setEditMode(null);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  // ── Render ──

  const renderDetailPanel = () => {
    if (editMode?.kind === "new-folder") {
      return (
        <FolderForm
          onSave={handleSaveFolder}
          onCancel={() => setEditMode(null)}
        />
      );
    }
    if (editMode?.kind === "edit-folder") {
      return (
        <FolderForm
          folder={editMode.folder}
          onSave={handleSaveFolder}
          onCancel={() => setEditMode(null)}
          isRoot={editMode.folder.id === root.id}
        />
      );
    }
    if (editMode?.kind === "new-connection") {
      return (
        <ConnectionForm
          onSave={handleSaveConnection}
          onCancel={() => setEditMode(null)}
        />
      );
    }
    if (editMode?.kind === "edit-connection") {
      return (
        <ConnectionForm
          connection={editMode.connection}
          onSave={handleSaveConnection}
          onCancel={() => setEditMode(null)}
          onConnect={() => handleConnect(editMode.connection.id)}
        />
      );
    }

    // Show selected item info
    if (selected?.kind === "connection") {
      const c = selected.data;
      return (
        <div className="detail-panel">
          <h2>🖥️ {c.name}</h2>
          <div className="detail-field">
            <strong>RustDesk ID:</strong> {c.rustdesk_id}
          </div>
          <div className="detail-field">
            <strong>Password:</strong> {c.password ? "••••••" : "(none)"}
          </div>
          {c.description && (
            <div className="detail-field">
              <strong>Description:</strong> {c.description}
            </div>
          )}
          <div className="form-actions">
            <button
              className="btn btn-connect"
              onClick={() => handleConnect(c.id)}
            >
              ▶ Connect
            </button>
            <button
              className="btn btn-primary"
              onClick={() =>
                setEditMode({ kind: "edit-connection", connection: c })
              }
            >
              Edit
            </button>
            <button
              className="btn btn-danger"
              onClick={() => handleDelete(c.id)}
            >
              Delete
            </button>
          </div>
        </div>
      );
    }

    if (selected?.kind === "folder") {
      const f = selected.data;
      return (
        <div className="detail-panel">
          <h2>📁 {f.name}</h2>
          {f.description && (
            <div className="detail-field">
              <strong>Description:</strong> {f.description}
            </div>
          )}
          <div className="detail-field">
            <strong>Items:</strong> {f.children.length}
          </div>
          <div className="form-actions">
            <button
              className="btn btn-primary"
              onClick={() => setEditMode({ kind: "edit-folder", folder: f })}
            >
              Edit
            </button>
            {f.id !== root.id && (
              <button
                className="btn btn-danger"
                onClick={() => handleDelete(f.id)}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="detail-panel detail-empty">
        <p>Select an item or right-click the tree to add connections.</p>
      </div>
    );
  };

  return (
    <div className="main-page">
      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-left">
          <button
            className="btn btn-small"
            onClick={() =>
              setEditMode({ kind: "new-folder", parentId: root.id })
            }
          >
            📁+ Folder
          </button>
          <button
            className="btn btn-small"
            onClick={() =>
              setEditMode({ kind: "new-connection", parentId: root.id })
            }
          >
            🖥️+ Connection
          </button>
        </div>
        <div className="toolbar-right">
          <button
            className="btn btn-small"
            onClick={() => setShowSettings(true)}
          >
            ⚙️ Settings
          </button>
          <button className="btn btn-small" onClick={onLock}>
            🔒 Lock
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button className="btn btn-small" onClick={() => setError("")}>
            ✕
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="content">
        <div className="sidebar" onContextMenu={handleRootContextMenu}>
          <TreeView
            nodes={root.children}
            parentId={root.id}
            onSelect={handleSelect}
            onConnect={handleConnect}
            onContextMenu={handleContextMenu}
            selectedId={
              selected?.kind === "folder"
                ? selected.data.id
                : selected?.kind === "connection"
                  ? selected.data.id
                  : null
            }
            onDrop={handleDrop}
          />
        </div>
        <div className="detail">{renderDetailPanel()}</div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="context-menu"
          ref={menuRef}
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.node.type === "Folder" && (
            <>
              <div
                className="context-item"
                onClick={() => {
                  setEditMode({
                    kind: "new-folder",
                    parentId: contextMenu.node.id,
                  });
                  setContextMenu(null);
                }}
              >
                📁 New Folder
              </div>
              <div
                className="context-item"
                onClick={() => {
                  setEditMode({
                    kind: "new-connection",
                    parentId: contextMenu.node.id,
                  });
                  setContextMenu(null);
                }}
              >
                🖥️ New Connection
              </div>
              <div className="context-separator" />
              <div
                className="context-item"
                onClick={() => {
                  setEditMode({
                    kind: "edit-folder",
                    folder: contextMenu.node as any,
                  });
                  setContextMenu(null);
                }}
              >
                ✏️ Edit Folder
              </div>
              {contextMenu.node.id !== root.id && (
                <div
                  className="context-item context-danger"
                  onClick={() => {
                    handleDelete(contextMenu.node.id);
                    setContextMenu(null);
                  }}
                >
                  🗑️ Delete Folder
                </div>
              )}
            </>
          )}
          {contextMenu.node.type === "Connection" && (
            <>
              <div
                className="context-item"
                onClick={() => {
                  handleConnect(contextMenu.node.id);
                  setContextMenu(null);
                }}
              >
                ▶ Connect
              </div>
              <div className="context-separator" />
              <div
                className="context-item"
                onClick={() => {
                  setEditMode({
                    kind: "edit-connection",
                    connection: contextMenu.node as any,
                  });
                  setContextMenu(null);
                }}
              >
                ✏️ Edit Connection
              </div>
              <div
                className="context-item context-danger"
                onClick={() => {
                  handleDelete(contextMenu.node.id);
                  setContextMenu(null);
                }}
              >
                🗑️ Delete Connection
              </div>
            </>
          )}
        </div>
      )}

      {/* Settings modal */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
