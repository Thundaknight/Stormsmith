import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

export default function InviteSignup({ token }: { token: string }) {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getInviteInfo(token).then((r) => setRole(r.role)).catch(() => setInvalid(true));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || /\s/.test(username.trim())) {
      setError('Username is required and cannot contain spaces');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const r = await api.redeemInvite(token, username.trim(), password);
      await loginWithToken(r.token);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <span className="brand-icon">⚡</span>
          <span>Stormsmith</span>
        </div>
        {invalid ? (
          <div className="alert alert-error">This invite link is invalid or has expired. Ask an admin to send you a new one.</div>
        ) : !role ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <p className="muted">You've been invited to Stormsmith. Choose a username and password to get started.</p>
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
                minLength={8}
                required
              />
            </label>
            <label>
              Confirm password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Working…' : 'Create account'}</button>
          </>
        )}
      </form>
    </div>
  );
}
