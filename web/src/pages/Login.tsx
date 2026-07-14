import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

export default function Login() {
  const { login, setup } = useAuth();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authStatus().then((r) => setNeedsSetup(r.needsSetup)).catch(() => setNeedsSetup(false));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (needsSetup && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      if (needsSetup) await setup(username, password);
      else await login(username, password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (needsSetup === null) return <div className="center-screen">Loading…</div>;

  return (
    <div className="center-screen">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <span className="brand-icon">⚡</span>
          <span>Stormsmith</span>
        </div>
        {needsSetup ? (
          <p className="muted">Welcome! Create the initial admin account to get started.</p>
        ) : (
          <p className="muted">Sign in to manage your game servers.</p>
        )}
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={needsSetup ? 8 : undefined}
          />
        </label>
        {needsSetup && (
          <label>
            Confirm password
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Please wait…' : needsSetup ? 'Create admin account' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
