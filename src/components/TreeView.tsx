import { useState, useCallback } from "react";
import type { TreeNode, SelectedItem } from "../types";
import { useI18n } from "../i18n";

interface Props {
  nodes: TreeNode[];
  parentId: string;
  onSelect: (item: SelectedItem) => void;
  onConnect: (connectionId: string) => void;
  onContextMenu: (
    e: React.MouseEvent,
    node: TreeNode,
    parentId: string,
  ) => void;
  selectedId: string | null;
  onDrop: (nodeId: string, newParentId: string, position: number) => void;
  // Checkbox mode (for export)
  checkMode?: boolean;
  checkedIds?: Set<string>;
  onCheck?: (id: string, checked: boolean) => void;
}

/** Collect all descendant IDs of a folder node */
function collectAllIds(node: TreeNode): string[] {
  const ids = [node.id];
  if (node.type === "Folder") {
    for (const child of node.children) {
      ids.push(...collectAllIds(child));
    }
  }
  return ids;
}

function TreeNodeItem({
  node,
  parentId,
  onSelect,
  onConnect,
  onContextMenu,
  selectedId,
  onDrop,
  checkMode,
  checkedIds,
  onCheck,
}: Props & { node: TreeNode }) {
  const [expanded, setExpanded] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const isFolder = node.type === "Folder";
  const isSelected = node.id === selectedId;
  const children = isFolder ? node.children : [];

  // Determine checkbox state for this node
  const isChecked = checkedIds?.has(node.id) ?? false;
  // For folders: partial = some but not all descendants checked
  const isPartial = isFolder && !isChecked && children.some((c) => {
    const ids = collectAllIds(c);
    return ids.some((id) => checkedIds?.has(id));
  });

  const handleCheckChange = useCallback(() => {
    if (!onCheck) return;
    const newChecked = !isChecked;
    // For folders, check/uncheck all descendants too
    const allIds = collectAllIds(node);
    for (const id of allIds) {
      onCheck(id, newChecked);
    }
  }, [isChecked, node, onCheck]);

  const handleClick = () => {
    if (checkMode) {
      handleCheckChange();
      return;
    }
    if (isFolder) {
      onSelect({ kind: "folder", data: node as any });
    } else {
      onSelect({ kind: "connection", data: node as any });
    }
  };

  const handleDoubleClick = () => {
    if (checkMode) return;
    if (isFolder) {
      setExpanded(!expanded);
    } else {
      onConnect(node.id);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (checkMode) { e.preventDefault(); return; }
    console.log("dragStart:", node.id, node.name);
    e.dataTransfer.setData("text/plain", node.id);
    e.dataTransfer.effectAllowed = "move";
    e.stopPropagation();
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (checkMode) return;
    if (isFolder) {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    }
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDropOnFolder = (e: React.DragEvent) => {
    if (checkMode) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const draggedId = e.dataTransfer.getData("text/plain");
    console.log("drop:", { draggedId, targetId: node.id, isFolder });
    if (draggedId && draggedId !== node.id && isFolder) {
      onDrop(draggedId, node.id, children.length);
    }
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-item ${isSelected && !checkMode ? "selected" : ""} ${dragOver ? "drag-over" : ""}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => { if (!checkMode) onContextMenu(e, node, parentId); }}
        draggable={!checkMode}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropOnFolder}
      >
        {checkMode && (
          <input
            type="checkbox"
            className="tree-checkbox"
            checked={isChecked}
            ref={(el) => { if (el) el.indeterminate = isPartial; }}
            onChange={handleCheckChange}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {isFolder && (
          <span
            className="tree-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? "▾" : "▸"}
          </span>
        )}
        <span className="tree-icon">{isFolder ? "📁" : "🖥️"}</span>
        <span className="tree-label">{node.name}</span>
        {!isFolder && (node as any).rustdesk_id && (
          <span className="tree-id">{(node as any).rustdesk_id}</span>
        )}
      </div>

      {isFolder && expanded && children.length > 0 && (
        <div className="tree-children">
          {children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              nodes={children}
              parentId={node.id}
              onSelect={onSelect}
              onConnect={onConnect}
              onContextMenu={onContextMenu}
              selectedId={selectedId}
              onDrop={onDrop}
              checkMode={checkMode}
              checkedIds={checkedIds}
              onCheck={onCheck}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TreeView({
  nodes,
  parentId,
  onSelect,
  onConnect,
  onContextMenu,
  selectedId,
  onDrop,
  checkMode,
  checkedIds,
  onCheck,
}: Props) {
  if (nodes.length === 0) {
    return <div className="tree-empty">{useI18n().noItemsYet}</div>;
  }

  return (
    <div className="tree-view">
      {nodes.map((node) => (
        <TreeNodeItem
          key={node.id}
          node={node}
          nodes={nodes}
          parentId={parentId}
          onSelect={onSelect}
          onConnect={onConnect}
          onContextMenu={onContextMenu}
          selectedId={selectedId}
          onDrop={onDrop}
          checkMode={checkMode}
          checkedIds={checkedIds}
          onCheck={onCheck}
        />
      ))}
    </div>
  );
}
