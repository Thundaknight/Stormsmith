import { Fragment, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import CopyButton from './CopyButton';
import { formatRelative } from '../format';
import type { WowAccount, WowCharacter } from '../types';

interface Props {
  serverId: number;
  dbConfigured: boolean;
  onLinkGenerated: () => void;
}

function ResetPasswordModal({ serverId, username, onClose, onLinkGenerated }: {
  serverId: number; username: string; onClose: () => void; onLinkGenerated: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setResult('');
    if (!password || password !== confirm) {
      setError('Passwords must match');
      return;
    }
    setBusy(true);
    try {
      const r = await api.sendRcon(serverId, `.account set password ${username} ${password} ${password}`);
      setResult(r.response.trim() || '(no response)');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const generateLink = async () => {
    setError('');
    setResult('');
    setLinkBusy(true);
    try {
      const r = await api.createWowResetLink(serverId, username);
      setLink({ url: `${window.location.origin}/wow-account/${r.token}`, expiresAt: r.expiresAt });
      onLinkGenerated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reset Password — {username}</h2>
        {error && <div className="alert alert-error">{error}</div>}
        {result && <div className="alert alert-ok" style={{ whiteSpace: 'pre-wrap' }}>{result}</div>}
        {link && (
          <div className="alert alert-ok">
            <div>Share this link with the player — it lets them set their own password.</div>
            <div className="inline-form" style={{ marginTop: 6 }}>
              <input className="mono" value={link.url} readOnly onFocus={(e) => e.target.select()} />
              <CopyButton text={link.url} />
            </div>
            <div className="hint">Expires {formatRelative(link.expiresAt)}, or as soon as it's used.</div>
          </div>
        )}
        <form className="form-grid" onSubmit={submit}>
          <label>
            New password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label>
            Confirm password
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          <div className="btn-row span-2">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Working…' : 'Reset Password'}</button>
            <button type="button" className="btn" disabled={linkBusy} onClick={generateLink}>
              {linkBusy ? 'Working…' : 'Generate Reset Link'}
            </button>
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AzerothPlayerList({ serverId, dbConfigured, onLinkGenerated }: Props) {
  const [accounts, setAccounts] = useState<WowAccount[] | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [characters, setCharacters] = useState<Map<string, WowCharacter[]>>(new Map());
  const [charactersError, setCharactersError] = useState('');
  const [resetTarget, setResetTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!dbConfigured) return;
    setError('');
    api.listWowAccounts(serverId)
      .then((r) => setAccounts(r.accounts))
      .catch((err) => setError(err.message));
  }, [serverId, dbConfigured]);

  const toggleCharacters = (username: string) => {
    if (expanded === username) {
      setExpanded(null);
      return;
    }
    setExpanded(username);
    setCharactersError('');
    if (!characters.has(username)) {
      api.listWowCharacters(serverId, username)
        .then((r) => setCharacters((prev) => new Map(prev).set(username, r.characters)))
        .catch((err) => setCharactersError(err.message));
    }
  };

  return (
    <div className="card">
      <h2>Player Accounts</h2>
      {!dbConfigured && (
        <div className="alert alert-warn">
          Connect the player database in the Settings tab to see a list of real accounts here.
        </div>
      )}
      {dbConfigured && error && <div className="alert alert-error">{error}</div>}
      {dbConfigured && !error && accounts === null && <div className="muted">Loading…</div>}
      {dbConfigured && !error && accounts && accounts.length === 0 && (
        <p className="muted">No player accounts yet.</p>
      )}
      {dbConfigured && !error && accounts && accounts.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Username</th><th>Status</th><th>Last login</th><th></th></tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <Fragment key={a.username}>
                <tr>
                  <td>{a.username}</td>
                  <td>{a.online ? <span className="chip chip-on">Online</span> : <span className="muted">Offline</span>}</td>
                  <td className="muted">{a.lastLogin ? formatRelative(a.lastLogin) : '—'}</td>
                  <td className="table-actions">
                    <button className="btn btn-small" onClick={() => toggleCharacters(a.username)}>
                      {expanded === a.username ? 'Hide characters' : 'Characters'}
                    </button>
                    <button className="btn btn-small" onClick={() => setResetTarget(a.username)}>Reset Password</button>
                  </td>
                </tr>
                {expanded === a.username && (
                  <tr>
                    <td colSpan={4}>
                      {charactersError && <div className="alert alert-error">{charactersError}</div>}
                      {!charactersError && !characters.has(a.username) && <div className="muted">Loading…</div>}
                      {!charactersError && characters.get(a.username)?.length === 0 && (
                        <p className="muted">No characters on this account.</p>
                      )}
                      {!charactersError && (characters.get(a.username)?.length ?? 0) > 0 && (
                        <div className="chip-list">
                          {characters.get(a.username)!.map((c) => (
                            <span key={c.name} className={`chip ${c.online ? 'chip-on' : ''}`}>
                              {c.name} {c.level} {c.race} {c.class}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {resetTarget && (
        <ResetPasswordModal
          serverId={serverId}
          username={resetTarget}
          onClose={() => setResetTarget(null)}
          onLinkGenerated={onLinkGenerated}
        />
      )}
    </div>
  );
}
