import { useState } from "react";
import type { TreeNode, SelectedItem } from "../types";

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
}

function TreeNodeItem({
  node,
  parentId,
  onSelect,
  onConnect,
  onContextMenu,
  selectedId,
  onDrop,
}: Props & { node: TreeNode }) {
  const [expanded, setExpanded] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const isFolder = node.type === "Folder";
  const isSelected = node.id === selectedId;
  const children = isFolder ? node.children : [];

  const handleClick = () => {
    if (isFolder) {
      onSelect({ kind: "folder", data: node as any });
    } else {
      onSelect({ kind: "connection", data: node as any });
    }
  };

  const handleDoubleClick = () => {
    if (isFolder) {
      setExpanded(!expanded);
    } else {
      onConnect(node.id);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", node.id);
    e.stopPropagation();
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (isFolder) {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    }
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDropOnFolder = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const draggedId = e.dataTransfer.getData("text/plain");
    if (draggedId && draggedId !== node.id && isFolder) {
      onDrop(draggedId, node.id, children.length);
    }
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-item ${isSelected ? "selected" : ""} ${dragOver ? "drag-over" : ""}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onContextMenu(e, node, parentId)}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropOnFolder}
      >
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
}: Props) {
  if (nodes.length === 0) {
    return <div className="tree-empty">No items yet. Right-click to add.</div>;
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
        />
      ))}
    </div>
  );
}
