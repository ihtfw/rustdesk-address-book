import { useState, useEffect } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import * as api from "../api";

interface Props {
  exists: boolean;
  storagePath: string;
  onUnlock: (password: string) => Promise<void>;
  onCreate: (password: string) => Promise<void>;
  onPathChanged: () => void;
}

export default function LockScreen({
  exists,
  storagePath,
  onUnlock,
  onCreate,
  onPathChanged,
}: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(storagePath);

  useEffect(() => {
    setCurrentPath(storagePath);
  }, [storagePath]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!exists && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }

    setLoading(true);
    try {
      if (exists) {
        await onUnlock(password);
      } else {
        await onCreate(password);
      }
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleBrowse = async () => {
    try {
      const selected = await open({
        title: "Select Address Book File",
        filters: [{ name: "Address Book", extensions: ["enc"] }],
      });
      if (selected) {
        await api.setStoragePath(selected);
        setCurrentPath(selected);
        onPathChanged();
      }
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleCreateAt = async () => {
    try {
      const selected = await save({
        title: "Choose Location for Address Book",
        defaultPath: "addressbook.enc",
        filters: [{ name: "Address Book", extensions: ["enc"] }],
      });
      if (selected) {
        await api.setStoragePath(selected);
        setCurrentPath(selected);
        onPathChanged();
      }
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleResetPath = async () => {
    try {
      await api.setStoragePath("");
      const defaultPath = await api.getStoragePath();
      setCurrentPath(defaultPath);
      onPathChanged();
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-icon">🔒</div>
        <h1>{exists ? "Unlock Address Book" : "Create Address Book"}</h1>
        <p className="lock-subtitle">
          {exists
            ? "Enter your master password to unlock"
            : "Set a master password to protect your connections"}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="password">Master Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password..."
              autoFocus
              disabled={loading}
            />
          </div>

          {!exists && (
            <div className="form-group">
              <label htmlFor="confirm">Confirm Password</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm password..."
                disabled={loading}
              />
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={loading}
          >
            {loading ? "Please wait..." : exists ? "Unlock" : "Create"}
          </button>
        </form>

        <div className="storage-path-section">
          <label>Address Book Location</label>
          <div className="storage-path-display" title={currentPath}>
            {currentPath}
          </div>
          <div className="storage-path-actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={handleBrowse}
              title="Open an existing address book file"
            >
              📂 Open...
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={handleCreateAt}
              title="Choose where to create a new address book"
            >
              💾 Save As...
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={handleResetPath}
              title="Reset to default location"
            >
              ↩ Default
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
