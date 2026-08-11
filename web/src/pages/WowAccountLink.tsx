import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';

export default function WowAccountLink({ token }: { token: string }) {
  const [info, setInfo] = useState<{ purpose: string; username: string; serverName: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.getWowAccountLinkInfo(token).then(setInfo).catch(() => setInvalid(true));
  }, [token]);

  const isCreate = info?.purpose === 'create';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (isCreate && (!username.trim() || /\s/.test(username.trim()))) {
      setError('Username is required and cannot contain spaces');
      return;
    }
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
      await api.redeemWowAccountLink(token, isCreate ? { username: username.trim(), password } : { password });
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
            {isCreate ? (
              <>Your account <strong>{username.trim()}</strong> on <strong>{info.serverName}</strong> is ready. You can now log in to the game.</>
            ) : (
              <>Your password for <strong>{info.username}</strong> on <strong>{info.serverName}</strong> has been updated. You can now log in to the game.</>
            )}
          </div>
        ) : (
          <form className="form-grid" onSubmit={submit}>
            <p className="muted">
              {isCreate
                ? <>Choose a username and password for your new account on <strong>{info.serverName}</strong>.</>
                : <>Set a new password for <strong>{info.username}</strong> on <strong>{info.serverName}</strong>.</>}
            </p>
            {isCreate && (
              <label>
                Username
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
              </label>
            )}
            <label>
              {isCreate ? 'Password' : 'New password'}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                maxLength={32}
                autoFocus={!isCreate}
                required
              />
            </label>
            <label>
              Confirm password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Working…' : isCreate ? 'Create account' : 'Set password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
