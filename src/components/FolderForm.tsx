import { useState, useEffect } from "react";
import type { Folder } from "../types";
import { useI18n } from "../i18n";

interface Props {
  folder?: Folder;
  onSave: (data: { name: string; description: string }) => void;
  onCancel: () => void;
  isRoot?: boolean;
  disabled?: boolean;
}

export default function FolderForm({
  folder,
  onSave,
  onCancel,
  isRoot,
  disabled,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const t = useI18n();

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
      <h2>{isEdit ? t.editFolderTitle : t.newFolderTitle}</h2>
      <form onSubmit={handleSubmit}>
        <fieldset disabled={disabled} style={{ border: "none", padding: 0, margin: 0 }}>
        <div className="form-group">
          <label htmlFor="folder-name">{t.name}</label>
          <input
            id="folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.folderNamePlaceholder}
            required
            disabled={isRoot}
          />
        </div>

        <div className="form-group">
          <label htmlFor="folder-desc">{t.description}</label>
          <textarea
            id="folder-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.folderDescPlaceholder}
            rows={3}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-action">
            💾 {isEdit ? t.save : t.addFolder}
          </button>
          <button type="button" className="btn btn-action" onClick={onCancel}>
            ✕ {t.cancel}
          </button>
        </div>
        </fieldset>
      </form>
    </div>
  );
}
