import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import VersionFooter from '../components/VersionFooter';

export default function Login() {
  const { login, setup, loginWithToken } = useAuth();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authStatus()
      .then((r) => {
        setNeedsSetup(r.needsSetup);
        setDiscordEnabled(r.discordOAuthEnabled);
      })
      .catch(() => setNeedsSetup(false));

    // Discord OAuth redirects back here with one of these query params
    const params = new URLSearchParams(window.location.search);
    const token = params.get('discordToken');
    const pending = params.get('discordPending');
    const discordError = params.get('discordError');
    if (token || pending || discordError) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (token) {
      loginWithToken(token).catch((err) => setError(err.message));
    } else if (pending) {
      setNotice('Your Discord sign-up was received. An administrator needs to approve your account before you can sign in.');
    } else if (discordError) {
      setError(discordError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {notice && <div className="alert alert-ok">{notice}</div>}
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Please wait…' : needsSetup ? 'Create admin account' : 'Sign in'}
        </button>
        {discordEnabled && !needsSetup && (
          <>
            <div className="login-divider"><span>or</span></div>
            <button
              type="button"
              className="btn btn-discord"
              onClick={() => { window.location.href = '/api/auth/discord/login'; }}
            >
              Sign in with Discord
            </button>
            <p className="hint" style={{ textAlign: 'center' }}>
              New here? Signing in with Discord creates an account pending administrator approval.
            </p>
          </>
        )}
      </form>
      <VersionFooter />
    </div>
  );
}
