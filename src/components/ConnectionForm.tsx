import { useState, useEffect } from "react";
import type { Connection } from "../types";

interface Props {
  connection?: Connection;
  onSave: (data: {
    name: string;
    description: string;
    rustdesk_id: string;
    password: string;
  }) => void;
  onCancel: () => void;
  onConnect?: () => void;
}

export default function ConnectionForm({
  connection,
  onSave,
  onCancel,
  onConnect,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rustdeskId, setRustdeskId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (connection) {
      setName(connection.name);
      setDescription(connection.description);
      setRustdeskId(connection.rustdesk_id);
      setPassword(connection.password);
    } else {
      setName("");
      setDescription("");
      setRustdeskId("");
      setPassword("");
    }
  }, [connection]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: name.trim(),
      description: description.trim(),
      rustdesk_id: rustdeskId.trim(),
      password,
    });
  };

  const isEdit = !!connection;

  return (
    <div className="detail-panel">
      <h2>{isEdit ? "Edit Connection" : "New Connection"}</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="conn-name">Name</label>
          <input
            id="conn-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Office Server"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="conn-id">RustDesk ID</label>
          <input
            id="conn-id"
            value={rustdeskId}
            onChange={(e) => setRustdeskId(e.target.value)}
            placeholder="e.g. 123456789"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="conn-pw">Password</label>
          <div className="password-field">
            <input
              id="conn-pw"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Static password (optional)"
            />
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="conn-desc">Description</label>
          <textarea
            id="conn-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes about this connection..."
            rows={3}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            {isEdit ? "Save" : "Add Connection"}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          {isEdit && onConnect && (
            <button
              type="button"
              className="btn btn-connect"
              onClick={onConnect}
            >
              ▶ Connect
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
