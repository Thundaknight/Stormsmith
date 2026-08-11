import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import CopyButton from './CopyButton';
import { formatRelative } from '../format';
import type { WowAccountLink } from '../types';

interface Props {
  serverId: number;
  links: WowAccountLink[];
  onLinksChanged: () => void;
}

const GM_LEVELS = [
  { value: '0', label: 'Player (no GM access)' },
  { value: '1', label: 'Moderator' },
  { value: '2', label: 'Game Master' },
  { value: '3', label: 'Administrator' },
];

/**
 * Creates AzerothCore login accounts (not Stormsmith users) via the GM
 * console over SOAP. Syntax verified against
 * https://www.azerothcore.org/wiki/gm-commands:
 *   .account create $account $password [$email]
 *   .account set gmlevel [$account] #level [#realmid]
 */
export default function AzerothAccounts({ serverId, links, onLinksChanged }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [gmLevel, setGmLevel] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const [linkBusy, setLinkBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  const reset = () => {
    setUsername('');
    setPassword('');
    setConfirm('');
    setEmail('');
    setLink(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setResult('');
    const user = username.trim();
    if (!user || /\s/.test(user)) {
      setError('Username is required and cannot contain spaces');
      return;
    }
    if (!password || password !== confirm) {
      setError('Passwords must match');
      return;
    }

    setBusy(true);
    try {
      const lines: string[] = [];
      const cmd = `.account create ${user} ${password}${email.trim() ? ` ${email.trim()}` : ''}`;
      const r = await api.sendRcon(serverId, cmd);
      lines.push(r.response.trim() || '(no response)');
      if (gmLevel !== '0') {
        const r2 = await api.sendRcon(serverId, `.account set gmlevel ${user} ${gmLevel} -1`);
        lines.push(r2.response.trim() || '(no response)');
      }
      setResult(lines.join('\n'));
      reset();
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
      const r = await api.createWowAccountCreateLink(serverId, parseInt(gmLevel, 10));
      setLink({ url: `${window.location.origin}/wow-account/${r.token}`, expiresAt: r.expiresAt });
      onLinksChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLinkBusy(false);
    }
  };

  const revokeLink = async (token: string) => {
    try {
      await api.revokeWowAccountLink(serverId, token);
      onLinksChanged();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="card">
      <h2>Create Account</h2>
      {error && <div className="alert alert-error">{error}</div>}
      {result && <div className="alert alert-ok" style={{ whiteSpace: 'pre-wrap' }}>{result}</div>}
      {link && (
        <div className="alert alert-ok">
          <div>Share this link with the player — it lets them choose their own username and password.</div>
          <div className="inline-form" style={{ marginTop: 6 }}>
            <input className="mono" value={link.url} readOnly onFocus={(e) => e.target.select()} />
            <CopyButton text={link.url} />
          </div>
          <div className="hint">Expires {formatRelative(link.expiresAt)}, or as soon as it's used.</div>
        </div>
      )}

      <p className="hint">
        Create the account yourself below, or leave the username and password blank and generate a link the
        player can use to set up their own — either way, the GM level you pick applies to the new account.
      </p>

      <form className="form-grid" onSubmit={submit}>
        <label>
          Username
          <input value={username} onChange={(e) => { setUsername(e.target.value); setLink(null); }} required />
        </label>
        <label>
          Email (optional)
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label>
          Confirm password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        <label>
          GM level
          <select value={gmLevel} onChange={(e) => setGmLevel(e.target.value)}>
            {GM_LEVELS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>
        <div className="btn-row span-2">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Working…' : 'Create Account'}</button>
          <button type="button" className="btn" disabled={linkBusy} onClick={generateLink}>
            {linkBusy ? 'Working…' : 'Generate Account Link'}
          </button>
        </div>
      </form>

      {links.length > 0 && (
        <>
          <h3 style={{ marginTop: 20 }}>Generated links</h3>
          <table className="table">
            <thead>
              <tr><th>Purpose</th><th>Username</th><th>GM level</th><th>Expires</th><th></th></tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.token}>
                  <td>{l.purpose === 'create' ? 'Create account' : 'Reset password'}</td>
                  <td className="mono">{l.username || '—'}</td>
                  <td>{l.purpose === 'create' ? GM_LEVELS.find((g) => g.value === String(l.gmLevel))?.label ?? l.gmLevel : '—'}</td>
                  <td className="muted">{formatRelative(l.expiresAt)}</td>
                  <td className="table-actions">
                    <CopyButton text={`${window.location.origin}/wow-account/${l.token}`} title="Copy link" />
                    <button className="btn btn-small btn-danger-outline" onClick={() => revokeLink(l.token)}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
