import { useState } from "react";

interface Props {
  exists: boolean;
  onUnlock: (password: string) => Promise<void>;
  onCreate: (password: string) => Promise<void>;
}

export default function LockScreen({ exists, onUnlock, onCreate }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      </div>
    </div>
  );
}
