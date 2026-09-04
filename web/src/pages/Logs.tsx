import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { DiscordLogEntry, ServerActivityEntry } from '../types';

const RESULT_LABELS: Record<string, string> = {
  success: 'Success',
  denied_permission: 'No permission',
  denied_channel: 'Wrong channel',
  not_azerothcore: 'Not AzerothCore',
  db_not_configured: 'DB not configured',
  not_bot: 'Not a bot',
  not_online: 'Bot offline',
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

const KINDS: Array<{ id: string; label: string }> = [
  { id: '', label: 'All' },
  { id: 'player', label: 'Players' },
  { id: 'command', label: 'Commands' },
  { id: 'broadcast', label: 'Broadcasts' },
  { id: 'action', label: 'Actions' },
  { id: 'config', label: 'Config' },
];
const KIND_LABEL: Record<string, string> = {
  command: 'Command', broadcast: 'Broadcast', action: 'Action', config: 'Config', player: 'Player',
};

function ServerActivityCard() {
  const [entries, setEntries] = useState<ServerActivityEntry[]>([]);
  const [kind, setKind] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const load = useCallback((before?: number) => {
    api.allActivity({ kind: kind || undefined, before, limit: 100 })
      .then((r) => {
        setEntries((prev) => (before ? [...prev, ...r.entries] : r.entries));
        setDone(r.entries.length < 100);
      })
      .catch((err) => setError(err.message));
  }, [kind]);

  useEffect(() => {
    setEntries([]);
    setDone(false);
    load();
  }, [load]);

  return (
    <div className="card">
      <h2>Server activity (all servers)</h2>
      <p className="muted">
        Every command, broadcast, container action and config change made through Stormsmith or the Discord bot,
        plus player connect/disconnect events, newest first.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="chip-list" style={{ marginBottom: 10 }}>
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`chip ${kind === k.id ? 'chip-on' : ''}`}
            onClick={() => setKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <p className="muted">Nothing logged yet.</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>Time</th><th>Server</th><th>Who</th><th>Kind</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(e.createdAt).toLocaleString()}</td>
                    <td>{e.serverName || <span className="muted">—</span>}</td>
                    <td>
                      {e.actor || <span className="muted">system</span>}
                      {e.source !== 'web' && <span className="hint"> via {e.source}</span>}
                    </td>
                    <td><span className="chip chip-on">{KIND_LABEL[e.kind] || e.kind}</span></td>
                    <td>
                      {e.kind === 'player'
                        ? <span>{e.target} <span className="muted">{e.detail}</span></span>
                        : <span className="mono">{e.detail || '—'}</span>}
                      {e.result === 'error' && (
                        <div className="hint" style={{ color: 'var(--red)' }}>failed: {e.target}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!done && (
            <button className="btn" style={{ marginTop: 10 }} onClick={() => load(entries[entries.length - 1].id)}>
              Load older
            </button>
          )}
        </>
      )}
    </div>
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

      <ServerActivityCard />

      <div className="card">
        <h2>Discord command activity</h2>
        <p className="muted">
          Every use of a sensitive Discord bot command — currently <span className="mono">/wowlevel</span> —
          including denied and failed attempts, newest first.
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
