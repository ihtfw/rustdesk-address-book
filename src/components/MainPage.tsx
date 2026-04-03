import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { Folder, TreeNode, SelectedItem, Connection } from "../types";
import * as api from "../api";
import { useI18n, type Locale } from "../i18n";
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
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

type EditMode =
  | null
  | { kind: "new-folder"; parentId: string }
  | { kind: "edit-folder"; folder: Folder }
  | { kind: "new-connection"; parentId: string }
  | { kind: "edit-connection"; connection: Connection };

export default function MainPage({
  initialRoot,
  onLock,
  locale,
  onLocaleChange,
}: Props) {
  const [root, setRoot] = useState<Folder>(initialRoot);
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [folderSearch, setFolderSearch] = useState("");
  const [connectionSearch, setConnectionSearch] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const t = useI18n();

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

  // ── Search / Filter ──

  const filteredNodes = useMemo(() => {
    const fl = folderSearch.toLowerCase().trim();
    const cl = connectionSearch.toLowerCase().trim();
    if (!fl && !cl) return root.children;

    // Step 1: Filter folders by name. Keep all connections inside matching folders.
    // Non-matching folders are hidden along with all their contents,
    // unless they contain a descendant folder that matches.
    function filterByFolder(nodes: TreeNode[]): TreeNode[] {
      const result: TreeNode[] = [];
      for (const node of nodes) {
        if (node.type === "Connection") {
          // Keep connections at current level (they belong to an already-accepted parent)
          result.push(node);
        } else {
          const matches = node.name.toLowerCase().includes(fl);
          if (matches) {
            // Folder matches — include it with ALL its original contents
            result.push(node);
          } else {
            // Folder doesn't match — only keep it if it has descendant folders that match
            // But strip out direct connections (they belong to non-matching folder)
            const childFolders = node.children.filter(
              (c) => c.type === "Folder",
            );
            const filteredChildren = filterByFolder(childFolders);
            if (filteredChildren.length > 0) {
              result.push({ ...node, children: filteredChildren });
            }
          }
        }
      }
      return result;
    }

    // Step 2: Filter connections. Remove folders with no remaining connections.
    function filterByConnection(nodes: TreeNode[]): TreeNode[] {
      const result: TreeNode[] = [];
      for (const node of nodes) {
        if (node.type === "Connection") {
          const match =
            node.name.toLowerCase().includes(cl) ||
            node.description.toLowerCase().includes(cl) ||
            node.rustdesk_id.toLowerCase().includes(cl);
          if (match) result.push(node);
        } else {
          const filteredChildren = filterByConnection(node.children);
          if (filteredChildren.length > 0) {
            result.push({ ...node, children: filteredChildren });
          }
        }
      }
      return result;
    }

    let nodes = root.children;
    if (fl) nodes = filterByFolder(nodes);
    if (cl) nodes = filterByConnection(nodes);
    return nodes;
  }, [root.children, folderSearch, connectionSearch]);

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
      const copyToClipboard = async (text: string) => {
        await navigator.clipboard.writeText(text);
        setToast(t.copied);
        setTimeout(() => setToast(""), 2000);
      };
      return (
        <div className="detail-panel">
          <h2>
            🖥️ {c.name}
            <button
              className="btn btn-small btn-copy"
              onClick={() =>
                copyToClipboard(`${c.name}\n${c.rustdesk_id}\n${c.password}`)
              }
              title={t.copyInfo}
            >
              📋
            </button>
          </h2>
          <div className="detail-field">
            <strong>{t.rustdeskId}</strong> {c.rustdesk_id}
            <button
              className="btn btn-small btn-copy"
              onClick={() => copyToClipboard(c.rustdesk_id)}
              title={t.copyId}
            >
              📋
            </button>
          </div>
          <div className="detail-field">
            <strong>{t.password}</strong> {c.password ? "••••••" : "(none)"}
          </div>
          {c.description && (
            <div className="detail-field">
              <strong>{t.description}</strong> {c.description}
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
              {t.edit}
            </button>
            <button
              className="btn btn-danger"
              onClick={() => handleDelete(c.id)}
            >
              {t.delete_}
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
              <strong>{t.description}</strong> {f.description}
            </div>
          )}
          <div className="detail-field">
            <strong>{t.items}</strong> {f.children.length}
          </div>
          <div className="form-actions">
            <button
              className="btn btn-primary"
              onClick={() => setEditMode({ kind: "edit-folder", folder: f })}
            >
              {t.edit}
            </button>
            {f.id !== root.id && (
              <button
                className="btn btn-danger"
                onClick={() => handleDelete(f.id)}
              >
                {t.delete_}
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="detail-panel detail-empty">
        <p>{t.selectItemHint}</p>
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
            {t.folder}
          </button>
          <button
            className="btn btn-small"
            onClick={() =>
              setEditMode({ kind: "new-connection", parentId: root.id })
            }
          >
            {t.connection}
          </button>
        </div>
        <div className="toolbar-right">
          <button
            className="btn btn-small"
            onClick={() => setShowSettings(true)}
          >
            {t.settings}
          </button>
          <button className="btn btn-small" onClick={onLock}>
            {t.lock}
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
          <div className="search-box">
            <input
              type="text"
              placeholder={t.filterFolders}
              value={folderSearch}
              onChange={(e) => setFolderSearch(e.target.value)}
            />
            <input
              type="text"
              placeholder={t.filterConnections}
              value={connectionSearch}
              onChange={(e) => setConnectionSearch(e.target.value)}
            />
          </div>
          <TreeView
            nodes={filteredNodes}
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
                {t.newFolder}
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
                {t.newConnection}
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
                {t.editFolder}
              </div>
              {contextMenu.node.id !== root.id && (
                <div
                  className="context-item context-danger"
                  onClick={() => {
                    handleDelete(contextMenu.node.id);
                    setContextMenu(null);
                  }}
                >
                  {t.deleteFolder}
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
                {t.connect}
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
                {t.editConnection}
              </div>
              <div
                className="context-item context-danger"
                onClick={() => {
                  handleDelete(contextMenu.node.id);
                  setContextMenu(null);
                }}
              >
                {t.deleteConnection}
              </div>
            </>
          )}
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          locale={locale}
          onLocaleChange={onLocaleChange}
        />
      )}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
