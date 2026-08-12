import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DiscordLogEntry } from '../types';

const RESULT_LABELS: Record<string, string> = {
  success: 'Success',
  denied_permission: 'No permission',
  denied_channel: 'Wrong channel',
  not_azerothcore: 'Not AzerothCore',
  db_not_configured: 'DB not configured',
  not_bot: 'Not a bot',
  invalid_target: 'Invalid target level',
  error: 'Error',
};

function ResultChip({ result }: { result: string }) {
  const ok = result === 'success';
  return (
    <span className={`chip ${ok ? 'chip-on' : 'chip-danger chip-on'}`}>
      {RESULT_LABELS[result] || result}
    </span>
  );
}

export default function Logs() {
  const [entries, setEntries] = useState<DiscordLogEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listDiscordLogs().then((r) => setEntries(r.entries)).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <div className="page-head"><h1>Logs</h1></div>
      <div className="card">
        <h2>Discord command activity</h2>
        <p className="muted">
          Every use of a sensitive Discord bot command — currently <span className="mono">/wowlevel</span> and{' '}
          <span className="mono">/wowgear</span> — including denied and failed attempts, newest first.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        {!error && entries === null && <div className="muted">Loading…</div>}
        {!error && entries && entries.length === 0 && <p className="muted">No activity logged yet.</p>}
        {!error && entries && entries.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th><th>User</th><th>Command</th><th>Server</th><th>Character</th><th>Result</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{new Date(e.createdAt).toLocaleString()}</td>
                    <td>{e.discordUsername || e.discordUserId}</td>
                    <td className="mono">/{e.command}</td>
                    <td>{e.serverName || '—'}</td>
                    <td className="mono">{e.characterName || '—'}</td>
                    <td>
                      <ResultChip result={e.result} />
                      {e.detail && <div className="hint">{e.detail}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
