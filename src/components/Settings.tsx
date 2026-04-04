import { useState, useEffect } from "react";
import * as api from "../api";
import type { Subscription, AccessTokenInfo } from "../types";
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
  const [subAccessToken, setSubAccessToken] = useState("");
  const [managingSubId, setManagingSubId] = useState<string | null>(null);
  const [accessTokens, setAccessTokens] = useState<AccessTokenInfo[]>([]);
  const [newTokenLabel, setNewTokenLabel] = useState("");
  const [newTokenPerms, setNewTokenPerms] = useState("rw");
  const [createdTokenValue, setCreatedTokenValue] = useState<string | null>(null);
  const [addingSub, setAddingSub] = useState(false);
  const [syncInterval, setSyncInterval] = useState(60);
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
    api
      .getSyncInterval()
      .then(setSyncInterval)
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
    if (!subName.trim() || !subUrl.trim() || !subKey.trim() || addingSub) return;
    setAddingSub(true);
    try {
      const sub = await api.addSubscription(subName.trim(), subUrl.trim(), subKey.trim(), subAccessToken.trim() || undefined);
      // Trigger first sync — if server is unreachable, roll back
      try {
        await api.syncSubscription(sub.id);
      } catch (syncErr: unknown) {
        // Remove the subscription we just created
        try { await api.removeSubscription(sub.id); } catch { /* best effort */ }
        throw new Error(String(syncErr));
      }
      // Fetch permissions from server and update subscription
      try {
        await api.checkSubscriptionPermissions(sub.id);
      } catch { /* server may be unreachable, permissions stay null */ }
      // Reload subscriptions to get updated admin_token + permissions
      try {
        const all = await api.getSubscriptions();
        setSubscriptions(all);
      } catch {
        setSubscriptions((prev) => [...prev, sub]);
      }
      setSubName("");
      setSubUrl("");
      setSubKey("");
      setSubAccessToken("");
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setAddingSub(false);
    }
  };

  const handleEditSubscription = (sub: Subscription) => {
    setEditingSub(sub);
    setSubName(sub.name);
    setSubUrl(sub.url);
    setSubKey(sub.master_key);
    setSubAccessToken(sub.access_token || "");
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
      setSubAccessToken("");
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
      if (managingSubId === id) setManagingSubId(null);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleManageAccess = async (subId: string) => {
    if (managingSubId === subId) {
      setManagingSubId(null);
      return;
    }
    setError("");
    setCreatedTokenValue(null);
    try {
      const tokens = await api.listAccessTokens(subId);
      setAccessTokens(tokens);
      setManagingSubId(subId);
      setNewTokenLabel("");
      setNewTokenPerms("rw");
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleCreateToken = async () => {
    if (!managingSubId || !newTokenLabel.trim()) return;
    setError("");
    try {
      const created = await api.createAccessToken(managingSubId, newTokenLabel.trim(), newTokenPerms);
      setCreatedTokenValue(created.token);
      setNewTokenLabel("");
      // Refresh token list
      const tokens = await api.listAccessTokens(managingSubId);
      setAccessTokens(tokens);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleRevokeToken = async (tokenId: number) => {
    if (!managingSubId || !confirm(t.revokeConfirm)) return;
    setError("");
    try {
      await api.revokeAccessToken(managingSubId, tokenId);
      const tokens = await api.listAccessTokens(managingSubId);
      setAccessTokens(tokens);
      setMessage(t.tokenRevoked);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleCopyToken = async (token: string) => {
    await navigator.clipboard.writeText(token);
    setMessage(t.tokenCopied);
  };

  const handleCancelEditSub = () => {
    setEditingSub(null);
    setSubName("");
    setSubUrl("");
    setSubKey("");
    setSubAccessToken("");
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
          <h3>{t.syncInterval}</h3>
          <div className="form-group" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number"
              min={1}
              max={600}
              value={syncInterval}
              onChange={(e) => {
                const v = Math.max(1, Math.min(600, Number(e.target.value) || 1));
                setSyncInterval(v);
                api.setSyncInterval(v).catch(() => {});
              }}
              style={{ width: 80 }}
            />
            <span>{t.syncIntervalMinutes}</span>
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
            <div key={sub.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: managingSubId === sub.id ? 0 : 8, padding: "6px 8px", background: "var(--bg-primary)", borderRadius: managingSubId === sub.id ? "var(--radius) var(--radius) 0 0" : "var(--radius)", border: "1px solid var(--border)" }}>
                <span style={{ flex: 1, fontSize: 13 }}>
                  🌐 {sub.name}
                  {sub.admin_token && <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "var(--accent)", color: "#fff" }}>{t.admin}</span>}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  {sub.last_synced ? new Date(sub.last_synced).toLocaleString() : t.never}
                </span>
                {sub.admin_token && (
                  <button className="btn btn-small" onClick={() => handleManageAccess(sub.id)}>
                    {t.manageAccess}
                  </button>
                )}
                <button className="btn btn-small" onClick={() => handleEditSubscription(sub)}>
                  {t.edit}
                </button>
                <button className="btn btn-small btn-danger" onClick={() => handleRemoveSubscription(sub.id)}>
                  {t.removeSubscription}
                </button>
              </div>
              {managingSubId === sub.id && (
                <div style={{ padding: "8px 10px", marginBottom: 8, background: "var(--bg-secondary)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 var(--radius) var(--radius)", fontSize: 13 }}>
                  <strong>{t.accessTokens}</strong>
                  {accessTokens.length === 0 && (
                    <p style={{ color: "var(--text-secondary)", margin: "6px 0" }}>{t.noTokens}</p>
                  )}
                  {accessTokens.map((tk) => (
                    <div key={tk.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", opacity: tk.revoked ? 0.5 : 1 }}>
                      <span style={{ flex: 1 }}>{tk.label}</span>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                        {tk.permissions === "ro" ? t.readOnly : t.readWrite}
                      </span>
                      {!tk.revoked && (
                        <button className="btn btn-small btn-danger" onClick={() => handleRevokeToken(tk.id)}>
                          {t.revokeToken}
                        </button>
                      )}
                      {tk.revoked && <span style={{ fontSize: 11, color: "var(--danger)" }}>✕</span>}
                    </div>
                  ))}
                  {createdTokenValue && (
                    <div style={{ margin: "8px 0", padding: 8, background: "var(--bg-primary)", border: "1px solid var(--accent)", borderRadius: "var(--radius)" }}>
                      <div style={{ fontSize: 12, color: "var(--accent)", marginBottom: 4 }}>{t.tokenCreated}</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <code style={{ flex: 1, fontSize: 11, wordBreak: "break-all", userSelect: "all" }}>{createdTokenValue}</code>
                        <button className="btn btn-small btn-primary" onClick={() => handleCopyToken(createdTokenValue)}>
                          {t.copyToken}
                        </button>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "end" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>{t.tokenLabel}</label>
                      <input value={newTokenLabel} onChange={(e) => setNewTokenLabel(e.target.value)} placeholder={t.tokenLabelPlaceholder} style={{ fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12 }}>{t.tokenPermissions}</label>
                      <select value={newTokenPerms} onChange={(e) => setNewTokenPerms(e.target.value)} style={{ fontSize: 12 }}>
                        <option value="rw">{t.readWrite}</option>
                        <option value="ro">{t.readOnly}</option>
                      </select>
                    </div>
                    <button className="btn btn-small btn-primary" onClick={handleCreateToken} disabled={!newTokenLabel.trim()}>
                      {t.createToken}
                    </button>
                  </div>
                </div>
              )}
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
            <div className="form-group">
              <label>{t.accessToken}</label>
              <input
                value={subAccessToken}
                onChange={(e) => setSubAccessToken(e.target.value)}
                placeholder={t.accessTokenPlaceholder}
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
                <button className="btn btn-primary" onClick={handleAddSubscription} disabled={addingSub || !subName.trim() || !subUrl.trim() || !subKey.trim()}>
                  {addingSub ? t.pleaseWait : t.addSubscription}
                </button>
              )}
            </div>
            {error && <div className="error-message" style={{ marginTop: 8 }}>{error}</div>}
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
