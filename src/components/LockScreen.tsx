import { useState, useEffect } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import * as api from "../api";
import { useI18n } from "../i18n";

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
  const t = useI18n();

  useEffect(() => {
    setCurrentPath(storagePath);
  }, [storagePath]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!exists && password !== confirm) {
      setError(t.passwordsDoNotMatch);
      return;
    }
    if (password.length < 4) {
      setError(t.passwordTooShort);
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
        title: t.selectAddressBookFile,
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
        title: t.chooseLocation,
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
        <h1>{exists ? t.unlockTitle : t.createTitle}</h1>
        <p className="lock-subtitle">
          {exists ? t.unlockSubtitle : t.createSubtitle}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="password">{t.masterPassword}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.enterPassword}
              autoFocus
              disabled={loading}
            />
          </div>

          {!exists && (
            <div className="form-group">
              <label htmlFor="confirm">{t.confirmPassword}</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t.confirmPasswordPlaceholder}
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
            {loading ? t.pleaseWait : exists ? t.unlock : t.create}
          </button>
        </form>

        <div className="storage-path-section">
          <label>{t.addressBookLocation}</label>
          <div className="storage-path-display" title={currentPath}>
            {currentPath}
          </div>
          <div className="storage-path-actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={handleBrowse}
              title={t.selectAddressBookFile}
            >
              {t.open}
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={handleCreateAt}
              title={t.chooseLocation}
            >
              {t.saveAs}
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={handleResetPath}
              title={t.default_}
            >
              {t.default_}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
