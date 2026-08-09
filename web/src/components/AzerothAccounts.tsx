import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';

interface Props {
  serverId: number;
}

const GM_LEVELS = [
  { value: '0', label: 'Player (no GM access)' },
  { value: '1', label: 'Moderator' },
  { value: '2', label: 'Game Master' },
  { value: '3', label: 'Administrator' },
];

type Mode = 'create' | 'reset';

/**
 * Creates and resets AzerothCore login accounts (not Stormsmith users) via
 * the GM console over SOAP. Syntax verified against
 * https://www.azerothcore.org/wiki/gm-commands:
 *   .account create $account $password [$email]
 *   .account set password $account $password $password
 *   .account set gmlevel [$account] #level [#realmid]
 */
export default function AzerothAccounts({ serverId }: Props) {
  const [mode, setMode] = useState<Mode>('create');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [gmLevel, setGmLevel] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const reset = () => {
    setUsername('');
    setPassword('');
    setConfirm('');
    setEmail('');
    setGmLevel('0');
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
      if (mode === 'create') {
        const cmd = `.account create ${user} ${password}${email.trim() ? ` ${email.trim()}` : ''}`;
        const r = await api.sendRcon(serverId, cmd);
        lines.push(r.response.trim() || '(no response)');
        if (gmLevel !== '0') {
          const r2 = await api.sendRcon(serverId, `.account set gmlevel ${user} ${gmLevel} -1`);
          lines.push(r2.response.trim() || '(no response)');
        }
      } else {
        const r = await api.sendRcon(serverId, `.account set password ${user} ${password} ${password}`);
        lines.push(r.response.trim() || '(no response)');
      }
      setResult(lines.join('\n'));
      reset();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Player Accounts</h2>
      <div className="chip-list" style={{ marginBottom: 12 }}>
        <button type="button" className={`chip ${mode === 'create' ? 'chip-on' : ''}`} onClick={() => { setMode('create'); reset(); setError(''); setResult(''); }}>
          Create Account
        </button>
        <button type="button" className={`chip ${mode === 'reset' ? 'chip-on' : ''}`} onClick={() => { setMode('reset'); reset(); setError(''); setResult(''); }}>
          Reset Password
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {result && <div className="alert alert-ok" style={{ whiteSpace: 'pre-wrap' }}>{result}</div>}

      <form className="form-grid" onSubmit={submit}>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        {mode === 'create' && (
          <label>
            Email (optional)
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        <label>
          {mode === 'create' ? 'Password' : 'New password'}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label>
          Confirm password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {mode === 'create' && (
          <label>
            GM level
            <select value={gmLevel} onChange={(e) => setGmLevel(e.target.value)}>
              {GM_LEVELS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>
        )}
        <div className="btn-row span-2">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Working…' : mode === 'create' ? 'Create Account' : 'Reset Password'}
          </button>
        </div>
      </form>
    </div>
  );
}
