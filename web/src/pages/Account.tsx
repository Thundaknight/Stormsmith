import { useEffect, useState } from 'react';
import { api, getToken } from '../api';
import { useAuth } from '../auth';
import type { Account } from '../types';

export default function AccountPage() {
  const { user } = useAuth();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.getAccount().then((r) => setAccount(r.account)).catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get('discordLinked')) {
      setNotice('✅ Discord account linked.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlink = async () => {
    setBusy(true);
    setError('');
    try {
      await api.unlinkDiscord();
      setNotice('Discord account unlinked.');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!account) {
    return (
      <div>
        <div className="page-head"><h1>Account</h1></div>
        {error ? <div className="alert alert-error">{error}</div> : <div className="muted">Loading…</div>}
      </div>
    );
  }

  return (
    <div>
      <div className="page-head"><h1>Account</h1></div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="card">
        <h2>Profile</h2>
        <div className="form-grid">
          <label>Username<input value={account.username} disabled /></label>
          <label>Role<input value={account.role} disabled /></label>
        </div>
      </div>

      <div className="card">
        <h2>Discord</h2>
        {account.discord_username ? (
          <>
            <p>Linked to <strong>{account.discord_username}</strong>.</p>
            <button
              className="btn btn-danger-outline"
              disabled={busy || !account.has_password}
              onClick={unlink}
            >
              Unlink Discord
            </button>
            {!account.has_password && (
              <p className="hint">
                Set a password (ask an admin to reset one for you) before unlinking, so you don't lose access to
                your account.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="muted">No Discord account linked.</p>
            <button
              type="button"
              className="btn btn-discord"
              onClick={() => { window.location.href = `/api/auth/discord/link?token=${encodeURIComponent(getToken())}`; }}
            >
              Link Discord Account
            </button>
          </>
        )}
      </div>

      {user?.role === 'admin' && (
        <p className="muted">
          Managing other users, including approving Discord sign-ups, is done from the Users page.
        </p>
      )}
    </div>
  );
}
