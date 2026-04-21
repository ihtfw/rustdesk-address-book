import { useState, useEffect } from "react";
import type { Connection } from "../types";
import { useI18n } from "../i18n";

interface Props {
  connection?: Connection;
  onSave: (data: {
    name: string;
    description: string;
    favorite: boolean;
    rustdesk_id: string;
    password: string;
  }) => void;
  onCancel: () => void;
  onConnect?: () => void;
  disabled?: boolean;
}

export default function ConnectionForm({
  connection,
  onSave,
  onCancel,
  onConnect,
  disabled,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [rustdeskId, setRustdeskId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const t = useI18n();

  useEffect(() => {
    if (connection) {
      setName(connection.name);
      setDescription(connection.description);
      setFavorite(connection.favorite);
      setRustdeskId(connection.rustdesk_id);
      setPassword(connection.password);
    } else {
      setName("");
      setDescription("");
      setFavorite(false);
      setRustdeskId("");
      setPassword("");
    }
    setShowPassword(false);
  }, [connection]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: name.trim(),
      description: description.trim(),
      favorite,
      rustdesk_id: rustdeskId.trim(),
      password,
    });
  };

  const isEdit = !!connection;

  return (
    <div className="detail-panel">
      <h2>{isEdit ? t.editConnectionTitle : t.newConnectionTitle}</h2>
      <form onSubmit={handleSubmit}>
        <fieldset disabled={disabled} style={{ border: "none", padding: 0, margin: 0 }}>
        <div className="form-group">
          <label htmlFor="conn-name">{t.name}</label>
          <input
            id="conn-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePlaceholder}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="conn-id">{t.rustdeskId}</label>
          <input
            id="conn-id"
            value={rustdeskId}
            onChange={(e) => setRustdeskId(e.target.value)}
            placeholder={t.rustdeskIdPlaceholder}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="conn-pw">{t.password}</label>
          <div className="password-field">
            <input
              id="conn-pw"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passwordPlaceholder}
            />
            <button
              type="button"
              className="btn btn-small btn-toggle-pw"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="conn-desc">{t.description}</label>
          <textarea
            id="conn-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.descriptionPlaceholder}
            rows={3}
          />
        </div>

        <div className="form-group form-group--checkbox">
          <label>
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
            />
            {t.favorite}
          </label>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-action">
            💾 {isEdit ? t.save : t.addConnection}
          </button>
          <button type="button" className="btn btn-action" onClick={onCancel}>
            ✕ {t.cancel}
          </button>
          {isEdit && onConnect && (
            <button
              type="button"
              className="btn btn-connect btn-action"
              onClick={onConnect}
            >
              ▶ Connect
            </button>
          )}
        </div>
        </fieldset>
      </form>
    </div>
  );
}
