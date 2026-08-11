import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatRelative } from '../format';
import type { WowAccount } from '../types';

interface Props {
  serverId: number;
  dbConfigured: boolean;
}

export default function AzerothPlayerList({ serverId, dbConfigured }: Props) {
  const [accounts, setAccounts] = useState<WowAccount[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!dbConfigured) return;
    setError('');
    api.listWowAccounts(serverId)
      .then((r) => setAccounts(r.accounts))
      .catch((err) => setError(err.message));
  }, [serverId, dbConfigured]);

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
            <tr><th>Username</th><th>Status</th><th>Last login</th></tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.username}>
                <td>{a.username}</td>
                <td>{a.online ? <span className="chip chip-on">Online</span> : <span className="muted">Offline</span>}</td>
                <td className="muted">{a.lastLogin ? formatRelative(a.lastLogin) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
