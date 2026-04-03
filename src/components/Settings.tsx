import { useState, useEffect } from "react";
import * as api from "../api";
import type { Subscription } from "../types";
import { useI18n, type Locale } from "../i18n";

interface Props {
  onClose: () => void;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

const LANGUAGE_OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
];

export default function Settings({ onClose, locale, onLocaleChange }: Props) {
  const [rustdeskPath, setRustdeskPath] = useState("");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [editingSub, setEditingSub] = useState<Subscription | null>(null);
  const [subName, setSubName] = useState("");
  const [subUrl, setSubUrl] = useState("");
  const [subKey, setSubKey] = useState("");
  const t = useI18n();

  useEffect(() => {
    api
      .getRustdeskPath()
      .then(setRustdeskPath)
      .catch(() => {});
    api
      .getAutoUpdate()
      .then(setAutoUpdate)
      .catch(() => {});
    api
      .getSubscriptions()
      .then(setSubscriptions)
      .catch(() => {});
  }, []);

  const handleAutoUpdateChange = async (checked: boolean) => {
    setAutoUpdate(checked);
    try {
      await api.setAutoUpdate(checked);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleSavePath = async () => {
    setError("");
    setMessage("");
    try {
      await api.setRustdeskPath(rustdeskPath);
      setMessage(t.rustdeskPathSaved);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleDetect = async () => {
    setError("");
    setMessage("");
    try {
      const path = await api.detectRustdesk();
      setRustdeskPath(path);
      await api.setRustdeskPath(path);
      setMessage(t.detected(path));
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError(t.newPasswordsDoNotMatch);
      return;
    }
    if (newPassword.length < 4) {
      setError(t.passwordTooShort);
      return;
    }
    try {
      await api.changePassword(oldPassword, newPassword);
      setMessage(t.passwordChangedSuccessfully);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleAddSubscription = async () => {
    setError("");
    if (!subName.trim() || !subUrl.trim() || !subKey.trim()) return;
    try {
      const sub = await api.addSubscription(subName.trim(), subUrl.trim(), subKey.trim());
      setSubscriptions((prev) => [...prev, sub]);
      setSubName("");
      setSubUrl("");
      setSubKey("");
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleEditSubscription = (sub: Subscription) => {
    setEditingSub(sub);
    setSubName(sub.name);
    setSubUrl(sub.url);
    setSubKey(sub.master_key);
  };

  const handleSaveSubscription = async () => {
    if (!editingSub) return;
    setError("");
    try {
      const updated = await api.updateSubscription(editingSub.id, subName.trim(), subUrl.trim(), subKey.trim());
      setSubscriptions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setEditingSub(null);
      setSubName("");
      setSubUrl("");
      setSubKey("");
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleRemoveSubscription = async (id: string) => {
    if (!confirm(t.removeSubscriptionConfirm)) return;
    setError("");
    try {
      await api.removeSubscription(id);
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleCancelEditSub = () => {
    setEditingSub(null);
    setSubName("");
    setSubUrl("");
    setSubKey("");
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t.settingsTitle}</h2>
          <button className="btn btn-small" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-section">
          <h3>{t.rustdeskExecutable}</h3>
          <div className="form-group">
            <label htmlFor="rd-path">{t.path}</label>
            <div className="input-row">
              <input
                id="rd-path"
                value={rustdeskPath}
                onChange={(e) => setRustdeskPath(e.target.value)}
                placeholder={t.pathPlaceholder}
              />
              <button className="btn" onClick={handleDetect}>
                {t.autoDetect}
              </button>
              <button className="btn btn-primary" onClick={handleSavePath}>
                {t.save}
              </button>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>{t.updates}</h3>
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoUpdate}
                onChange={(e) => handleAutoUpdateChange(e.target.checked)}
              />
              {t.autoCheckUpdates}
            </label>
          </div>
        </div>

        <div className="settings-section">
          <h3>{t.language}</h3>
          <div className="form-group">
            <select
              value={locale}
              onChange={(e) => onLocaleChange(e.target.value as Locale)}
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="settings-section">
          <h3>{t.subscriptions}</h3>
          {subscriptions.length === 0 && !editingSub && (
            <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 12 }}>
              {t.noSubscriptions}
            </p>
          )}
          {subscriptions.map((sub) => (
            <div key={sub.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "6px 8px", background: "var(--bg-primary)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <span style={{ flex: 1, fontSize: 13 }}>🌐 {sub.name}</span>
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                {sub.last_synced ? new Date(sub.last_synced).toLocaleString() : t.never}
              </span>
              <button className="btn btn-small" onClick={() => handleEditSubscription(sub)}>
                {t.edit}
              </button>
              <button className="btn btn-small btn-danger" onClick={() => handleRemoveSubscription(sub.id)}>
                {t.removeSubscription}
              </button>
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <div className="form-group">
              <label>{t.subscriptionName}</label>
              <input
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
                placeholder={t.subscriptionNamePlaceholder}
              />
            </div>
            <div className="form-group">
              <label>{t.subscriptionUrl}</label>
              <input
                value={subUrl}
                onChange={(e) => setSubUrl(e.target.value)}
                placeholder={t.subscriptionUrlPlaceholder}
              />
            </div>
            <div className="form-group">
              <label>{t.subscriptionKey}</label>
              <input
                value={subKey}
                onChange={(e) => setSubKey(e.target.value)}
                placeholder={t.subscriptionKeyPlaceholder}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {editingSub ? (
                <>
                  <button className="btn btn-primary" onClick={handleSaveSubscription}>
                    {t.save}
                  </button>
                  <button className="btn" onClick={handleCancelEditSub}>
                    {t.cancel}
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={handleAddSubscription} disabled={!subName.trim() || !subUrl.trim() || !subKey.trim()}>
                  {t.addSubscription}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>{t.changeMasterPassword}</h3>
          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label htmlFor="old-pw">{t.currentPassword}</label>
              <input
                id="old-pw"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-pw">{t.newPassword}</label>
              <input
                id="new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirm-pw">{t.confirmNewPassword}</label>
              <input
                id="confirm-pw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary">
              {t.changePassword}
            </button>
          </form>
        </div>

        {message && <div className="success-message">{message}</div>}
        {error && <div className="error-message">{error}</div>}
      </div>
    </div>
  );
}
