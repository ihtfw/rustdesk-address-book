import { useState, useEffect } from "react";
import type { Folder } from "../types";

interface Props {
  folder?: Folder;
  onSave: (data: { name: string; description: string }) => void;
  onCancel: () => void;
  isRoot?: boolean;
}

export default function FolderForm({
  folder,
  onSave,
  onCancel,
  isRoot,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (folder) {
      setName(folder.name);
      setDescription(folder.description);
    } else {
      setName("");
      setDescription("");
    }
  }, [folder]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name: name.trim(), description: description.trim() });
  };

  const isEdit = !!folder;

  return (
    <div className="detail-panel">
      <h2>{isEdit ? "Edit Folder" : "New Folder"}</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="folder-name">Name</label>
          <input
            id="folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Office Servers"
            required
            disabled={isRoot}
          />
        </div>

        <div className="form-group">
          <label htmlFor="folder-desc">Description</label>
          <textarea
            id="folder-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes about this folder..."
            rows={3}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            {isEdit ? "Save" : "Add Folder"}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
