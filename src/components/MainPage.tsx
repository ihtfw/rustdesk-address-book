import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { Folder, TreeNode, SelectedItem, Connection, Subscription } from "../types";
import * as api from "../api";
import { useI18n, type Locale } from "../i18n";
import { save, open } from "@tauri-apps/plugin-dialog";
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
  const [undoToast, setUndoToast] = useState<{path: string; icon: string} | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [folderSearch, setFolderSearch] = useState("");
  const [connectionSearch, setConnectionSearch] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const t = useI18n();

  // Export/Import state
  const [exportMode, setExportMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [showExportPassword, setShowExportPassword] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [showImportPassword, setShowImportPassword] = useState(false);
  const [importPassword, setImportPassword] = useState("");
  const [importFilePath, setImportFilePath] = useState("");
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [syncErrors, setSyncErrors] = useState<Map<string, string>>(new Map());

  const subscriptionFolderIds = useMemo(
    () => new Set(subscriptions.map((s) => s.folder_id)),
    [subscriptions],
  );

  // Find which subscription a node belongs to (if any)
  const findSubscriptionForNode = useCallback(
    (nodeId: string): Subscription | null => {
      const isInside = (node: TreeNode, id: string): boolean => {
        if (node.id === id) return true;
        if (node.type === "Folder")
          return node.children.some((c) => isInside(c, id));
        return false;
      };
      for (const sub of subscriptions) {
        const folder = root.children.find((c) => c.id === sub.folder_id);
        if (folder && isInside(folder, nodeId)) return sub;
      }
      return null;
    },
    [subscriptions, root],
  );

  // Sync a subscription silently (no error toast, used for auto-sync after mutations)
  const syncQuiet = useCallback(
    async (subId: string) => {
      try {
        await api.syncSubscription(subId);
      } catch {
        // auto-sync errors are silent; user can retry manually
      }
    },
    [],
  );

  const syncErrorFolderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sub of subscriptions) {
      if (syncErrors.has(sub.id)) ids.add(sub.folder_id);
    }
    return ids;
  }, [subscriptions, syncErrors]);

  const refreshTree = useCallback(async () => {
    try {
      const tree = await api.getTree();
      setRoot(tree);
      const subs = await api.getSubscriptions();
      setSubscriptions(subs);
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

  // Adjust context menu position if it overflows the viewport
  useEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let { x, y } = contextMenu;
    let adjusted = false;
    if (rect.bottom > window.innerHeight) {
      y = Math.max(0, y - rect.height);
      adjusted = true;
    }
    if (rect.right > window.innerWidth) {
      x = Math.max(0, x - rect.width);
      adjusted = true;
    }
    if (adjusted) {
      setContextMenu((prev) => prev && { ...prev, x, y });
    }
  }, [contextMenu]);

  // Load subscriptions on mount
  useEffect(() => {
    api.getSubscriptions().then(setSubscriptions).catch(() => {});
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
      const sub =
        findSubscriptionForNode(nodeId) ||
        findSubscriptionForNode(newParentId);
      await api.moveNode(nodeId, newParentId, position);
      if (sub) await syncQuiet(sub.id);
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
    if (saving) return;
    setSaving(true);
    try {
      setError("");
      let subToSync: Subscription | null = null;
      if (editMode?.kind === "new-folder") {
        subToSync = findSubscriptionForNode(editMode.parentId);
        const folder = await api.addFolder(
          editMode.parentId,
          data.name,
          data.description,
        );
        setSelected({ kind: "folder", data: folder });
      } else if (editMode?.kind === "edit-folder") {
        subToSync = findSubscriptionForNode(editMode.folder.id);
        const folder = await api.updateFolder(
          editMode.folder.id,
          data.name,
          data.description,
        );
        setSelected({ kind: "folder", data: folder });
      }
      if (subToSync) await syncQuiet(subToSync.id);
      await refreshTree();
      setEditMode(null);
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveConnection = async (data: {
    name: string;
    description: string;
    rustdesk_id: string;
    password: string;
  }) => {
    if (saving) return;
    setSaving(true);
    try {
      setError("");
      let subToSync: Subscription | null = null;
      if (editMode?.kind === "new-connection") {
        subToSync = findSubscriptionForNode(editMode.parentId);
        const conn = await api.addConnection(
          editMode.parentId,
          data.name,
          data.description,
          data.rustdesk_id,
          data.password,
        );
        setSelected({ kind: "connection", data: conn });
      } else if (editMode?.kind === "edit-connection") {
        subToSync = findSubscriptionForNode(editMode.connection.id);
        const conn = await api.updateConnection(
          editMode.connection.id,
          data.name,
          data.description,
          data.rustdesk_id,
          data.password,
        );
        setSelected({ kind: "connection", data: conn });
      }
      if (subToSync) await syncQuiet(subToSync.id);
      await refreshTree();
      setEditMode(null);
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  // Build full path to a node by ID, e.g. "Office / Servers / My PC"
  const getNodeInfo = (nodeId: string): {path: string; icon: string} | null => {
    const walk = (nodes: TreeNode[], trail: string[]): {path: string; icon: string} | null => {
      for (const node of nodes) {
        const cur = [...trail, node.name];
        if (node.id === nodeId) {
          return {
            path: cur.join(" / "),
            icon: node.type === "Folder" ? "📁" : "🖥️",
          };
        }
        if (node.type === "Folder") {
          const found = walk(node.children, cur);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(root.children, []);
  };

  const handleDelete = async (id: string) => {
    try {
      setError("");
      const info = getNodeInfo(id);
      const subToSync = findSubscriptionForNode(id);
      await api.deleteNode(id);
      if (subToSync) await syncQuiet(subToSync.id);
      await refreshTree();
      setSelected(null);
      setEditMode(null);

      // Show undo toast for 5 seconds
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoToast(info);
      undoTimerRef.current = setTimeout(() => {
        setUndoToast(null);
        undoTimerRef.current = null;
      }, 5000);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleUndo = async () => {
    try {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoToast(null);
      undoTimerRef.current = null;
      await api.undoDelete();
      await refreshTree();
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  // ── Export / Import ──

  const handleExportStart = () => {
    setExportMode(true);
    setCheckedIds(new Set());
    setEditMode(null);
  };

  const handleExportCancel = () => {
    setExportMode(false);
    setCheckedIds(new Set());
  };

  const handleCheck = (id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const collectAllIds = (nodes: TreeNode[]): string[] => {
    const ids: string[] = [];
    for (const node of nodes) {
      ids.push(node.id);
      if (node.type === "Folder") ids.push(...collectAllIds(node.children));
    }
    return ids;
  };

  const handleSelectAll = () => {
    const allIds = collectAllIds(root.children);
    setCheckedIds(new Set(allIds));
  };

  const handleDeselectAll = () => {
    setCheckedIds(new Set());
  };

  const handleExportConfirm = () => {
    if (checkedIds.size === 0) {
      setError(t.noNodesSelected);
      return;
    }
    setExportPassword("");
    setShowExportPassword(true);
  };

  const handleExportExecute = async () => {
    try {
      setError("");
      const filePath = await save({
        title: t.saveExportFile,
        filters: [{ name: "Encrypted Address Book", extensions: ["enc"] }],
      });
      if (!filePath) return;

      // If password is empty, backend will receive empty string.
      // We pass current master password from the backend side if empty.
      await api.exportNodes(
        Array.from(checkedIds),
        exportPassword, // empty = use current
        filePath,
      );

      setShowExportPassword(false);
      setExportMode(false);
      setCheckedIds(new Set());
      setToast(t.exportSuccess);
      setTimeout(() => setToast(""), 3000);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleImport = async () => {
    try {
      setError("");
      const filePath = await open({
        title: t.selectImportFile,
        filters: [{ name: "Encrypted Address Book", extensions: ["enc"] }],
      });
      if (!filePath) return;

      // Try with current master password first
      const sameKey = await api.tryImport(filePath);
      if (sameKey) {
        // Current password works — import directly with empty string
        // Backend needs the actual password though, so we pass empty and handle in command
        await api.importNodes(filePath, "");
        await refreshTree();
        setToast(t.importSuccess);
        setTimeout(() => setToast(""), 3000);
      } else {
        // Need a different password
        setImportFilePath(filePath);
        setImportPassword("");
        setShowImportPassword(true);
      }
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleImportExecute = async () => {
    try {
      setError("");
      await api.importNodes(importFilePath, importPassword);
      await refreshTree();
      setShowImportPassword(false);
      setToast(t.importSuccess);
      setTimeout(() => setToast(""), 3000);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  // ── Sync ──

  const handleSync = async (subscriptionId: string) => {
    setSyncingIds((prev) => new Set(prev).add(subscriptionId));
    setSyncErrors((prev) => {
      const next = new Map(prev);
      next.delete(subscriptionId);
      return next;
    });
    try {
      await api.syncSubscription(subscriptionId);
      await refreshTree();
      setToast(t.syncSuccess);
      setTimeout(() => setToast(""), 3000);
    } catch (err: unknown) {
      const msg = String(err);
      const display = msg.includes("Please update the application")
        ? t.syncVersionError
        : msg;
      setSyncErrors((prev) => new Map(prev).set(subscriptionId, display));
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(subscriptionId);
        return next;
      });
    }
  };

  // Auto-sync every hour
  useEffect(() => {
    if (subscriptions.length === 0) return;
    const interval = setInterval(() => {
      for (const sub of subscriptions) {
        handleSync(sub.id);
      }
    }, 3600000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptions]);

  // ── Render ──

  const renderDetailPanel = () => {
    if (editMode?.kind === "new-folder") {
      return (
        <FolderForm
          onSave={handleSaveFolder}
          onCancel={() => setEditMode(null)}
          disabled={saving}
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
          disabled={saving}
        />
      );
    }
    if (editMode?.kind === "new-connection") {
      return (
        <ConnectionForm
          onSave={handleSaveConnection}
          onCancel={() => setEditMode(null)}
          disabled={saving}
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
          disabled={saving}
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
              className="btn btn-connect btn-action"
              onClick={() => handleConnect(c.id)}
            >
              ▶ Connect
            </button>
            <button
              className="btn btn-primary btn-action"
              onClick={() =>
                setEditMode({ kind: "edit-connection", connection: c })
              }
            >
              ✏️ {t.edit}
            </button>
            <button
              className="btn btn-danger btn-action"
              onClick={() => handleDelete(c.id)}
            >
              🗑️ {t.delete_}
            </button>
          </div>
        </div>
      );
    }

    if (selected?.kind === "folder") {
      const f = selected.data;
      const sub = subscriptions.find((s) => s.folder_id === f.id);
      return (
        <div className="detail-panel">
          <h2>{sub ? "🌐" : "📁"} {f.name}</h2>
          {f.description && (
            <div className="detail-field">
              <strong>{t.description}</strong> {f.description}
            </div>
          )}
          <div className="detail-field">
            <strong>{t.items}</strong> {f.children.length}
          </div>
          {sub && (
            <div className="detail-field">
              <strong>{t.lastSynced}</strong>{" "}
              {sub.last_synced ?? t.never}
            </div>
          )}
          {sub && syncErrors.has(sub.id) && (
            <div className="detail-field detail-error">
              ⚠️ {t.syncError}: {syncErrors.get(sub.id)}
            </div>
          )}
          <div className="form-actions">
            {sub && (
              <button
                className="btn btn-action"
                onClick={() => handleSync(sub.id)}
                disabled={syncingIds.has(sub.id)}
              >
                {syncingIds.has(sub.id) ? t.syncing : t.syncNow}
              </button>
            )}
            <button
              className="btn btn-primary btn-action"
              onClick={() => setEditMode({ kind: "edit-folder", folder: f })}
            >
              ✏️ {t.edit}
            </button>
            {f.id !== root.id && (
              <button
                className="btn btn-danger btn-action"
                onClick={() => handleDelete(f.id)}
              >
                🗑️ {t.delete_}
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
        {exportMode ? (
          <>
            <div className="toolbar-left">
              <button className="btn btn-small" onClick={handleSelectAll}>
                {t.selectAll}
              </button>
              <button className="btn btn-small" onClick={handleDeselectAll}>
                {t.deselectAll}
              </button>
            </div>
            <div className="toolbar-right">
              <button className="btn btn-small btn-danger" onClick={handleExportCancel}>
                {t.exportCancel}
              </button>
              <button className="btn btn-small btn-primary" onClick={handleExportConfirm}>
                {t.exportConfirm}
              </button>
            </div>
          </>
        ) : (
          <>
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
              <button className="btn btn-small" onClick={handleExportStart}>
                {t.export_}
              </button>
              <button className="btn btn-small" onClick={handleImport}>
                {t.import_}
              </button>
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
          </>
        )}
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
        <div className={`sidebar ${exportMode ? "sidebar-full" : ""}`} onContextMenu={handleRootContextMenu}>
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
            checkMode={exportMode}
            checkedIds={checkedIds}
            onCheck={handleCheck}
            subscriptionFolderIds={subscriptionFolderIds}
            syncErrorFolderIds={syncErrorFolderIds}
          />
        </div>
        {!exportMode && <div className="detail">{renderDetailPanel()}</div>}
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
              {subscriptionFolderIds.has(contextMenu.node.id) && (
                <>
                  <div
                    className="context-item"
                    onClick={() => {
                      const sub = subscriptions.find(
                        (s) => s.folder_id === contextMenu.node.id,
                      );
                      if (sub) handleSync(sub.id);
                      setContextMenu(null);
                    }}
                  >
                    {syncingIds.has(
                      subscriptions.find(
                        (s) => s.folder_id === contextMenu.node.id,
                      )?.id ?? "",
                    )
                      ? t.syncing
                      : t.syncNow}
                  </div>
                  <div className="context-separator" />
                </>
              )}
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
              {!subscriptionFolderIds.has(contextMenu.node.id) && (
                <>
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
          onClose={() => {
            setShowSettings(false);
            refreshTree();
          }}
          locale={locale}
          onLocaleChange={onLocaleChange}
        />
      )}

      {/* Export password modal */}
      {showExportPassword && (
        <div className="modal-overlay" onClick={() => setShowExportPassword(false)}>
          <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
            <h2>{t.exportPasswordTitle}</h2>
            <p className="modal-hint">{t.exportPasswordHint}</p>
            <div className="form-group">
              <label>{t.password}</label>
              <input
                type="password"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
                placeholder={t.enterPassword}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleExportExecute(); }}
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-action" onClick={() => setShowExportPassword(false)}>
                ✕ {t.cancel}
              </button>
              <button className="btn btn-primary btn-action" onClick={handleExportExecute}>
                {t.exportConfirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import password modal */}
      {showImportPassword && (
        <div className="modal-overlay" onClick={() => setShowImportPassword(false)}>
          <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
            <h2>{t.importPasswordTitle}</h2>
            <p className="modal-hint">{t.importPasswordHint}</p>
            <div className="form-group">
              <label>{t.password}</label>
              <input
                type="password"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
                placeholder={t.enterPassword}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleImportExecute(); }}
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-action" onClick={() => setShowImportPassword(false)}>
                ✕ {t.cancel}
              </button>
              <button className="btn btn-primary btn-action" onClick={handleImportExecute}>
                {t.import_}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
      {undoToast && (
        <div className="toast toast-undo">
          <span className="toast-undo-text">
            🗑️ {t.deleted} {undoToast.icon} <strong>{undoToast.path}</strong>
          </span>
          <button className="btn btn-small btn-undo" onClick={handleUndo}>
            ↩ {t.undo}
          </button>
        </div>
      )}
    </div>
  );
}
