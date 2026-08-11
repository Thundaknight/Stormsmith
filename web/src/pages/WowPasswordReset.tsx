import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';

export default function WowPasswordReset({ token }: { token: string }) {
  const [info, setInfo] = useState<{ username: string; serverName: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.getWowResetInfo(token).then(setInfo).catch(() => setInvalid(true));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await api.submitWowReset(token, password);
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <div className="card login-card">
        <div className="brand login-brand">
          <span className="brand-icon">⚡</span>
          <span>Stormsmith</span>
        </div>
        {invalid ? (
          <div className="alert alert-error">This link is invalid or has expired. Ask an admin to send you a new one.</div>
        ) : !info ? (
          <p className="muted">Loading…</p>
        ) : done ? (
          <div className="alert alert-ok">
            Your password for <strong>{info.username}</strong> on <strong>{info.serverName}</strong> has been updated.
            You can now log in to the game.
          </div>
        ) : (
          <form className="form-grid" onSubmit={submit}>
            <p className="muted">
              Set a new password for <strong>{info.username}</strong> on <strong>{info.serverName}</strong>.
            </p>
            <label>
              New password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                maxLength={32}
                autoFocus
                required
              />
            </label>
            <label>
              Confirm password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Working…' : 'Set password'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
