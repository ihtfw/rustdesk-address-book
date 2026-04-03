import { useState, useEffect } from "react";
import * as api from "../api";

interface Props {
  onClose: () => void;
}

export default function Settings({ onClose }: Props) {
  const [rustdeskPath, setRustdeskPath] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getRustdeskPath()
      .then(setRustdeskPath)
      .catch(() => {});
  }, []);

  const handleSavePath = async () => {
    setError("");
    setMessage("");
    try {
      await api.setRustdeskPath(rustdeskPath);
      setMessage("RustDesk path saved");
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
      setMessage(`Detected: ${path}`);
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    if (newPassword.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }
    try {
      await api.changePassword(oldPassword, newPassword);
      setMessage("Password changed successfully");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="btn btn-small" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-section">
          <h3>RustDesk Executable</h3>
          <div className="form-group">
            <label htmlFor="rd-path">Path</label>
            <div className="input-row">
              <input
                id="rd-path"
                value={rustdeskPath}
                onChange={(e) => setRustdeskPath(e.target.value)}
                placeholder="Path to rustdesk executable..."
              />
              <button className="btn" onClick={handleDetect}>
                Auto-detect
              </button>
              <button className="btn btn-primary" onClick={handleSavePath}>
                Save
              </button>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>Change Master Password</h3>
          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label htmlFor="old-pw">Current Password</label>
              <input
                id="old-pw"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-pw">New Password</label>
              <input
                id="new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirm-pw">Confirm New Password</label>
              <input
                id="confirm-pw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Change Password
            </button>
          </form>
        </div>

        {message && <div className="success-message">{message}</div>}
        {error && <div className="error-message">{error}</div>}
      </div>
    </div>
  );
}
