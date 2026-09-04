import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { RosterPlayer, ServerActivityEntry } from '../types';

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

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function ActivityRow({ e }: { e: ServerActivityEntry }) {
  const failed = e.result === 'error';
  return (
    <tr>
      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(e.createdAt)}</td>
      <td>
        {e.actor || <span className="muted">system</span>}
        {e.source !== 'web' && <span className="hint"> via {e.source}</span>}
      </td>
      <td><span className="chip chip-on">{KIND_LABEL[e.kind] || e.kind}</span></td>
      <td>
        {e.kind === 'player' ? (
          <span>{e.target} <span className="muted">{e.detail}</span></span>
        ) : (
          <span className="mono">{e.detail || '—'}</span>
        )}
        {failed && <div className="hint" style={{ color: 'var(--red)' }}>failed: {e.target}</div>}
      </td>
    </tr>
  );
}

export default function ServerLogs({ serverId }: { serverId: number }) {
  const [players, setPlayers] = useState<RosterPlayer[] | null>(null);
  const [playersSupported, setPlayersSupported] = useState(true);
  const [entries, setEntries] = useState<ServerActivityEntry[]>([]);
  const [kind, setKind] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.serverPlayers(serverId)
      .then((r) => { setPlayers(r.players); setPlayersSupported(r.supported); })
      .catch((err) => setError(err.message));
  }, [serverId]);

  const loadActivity = useCallback((before?: number) => {
    api.serverActivity(serverId, { kind: kind || undefined, before, limit: 100 })
      .then((r) => {
        setEntries((prev) => (before ? [...prev, ...r.entries] : r.entries));
        setDone(r.entries.length < 100);
      })
      .catch((err) => setError(err.message));
  }, [serverId, kind]);

  useEffect(() => {
    setEntries([]);
    setDone(false);
    loadActivity();
  }, [loadActivity]);

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <h2>Players</h2>
        <p className="hint">
          Everyone Stormsmith has seen connected to this server, most recently seen first. Detected from the
          player list roughly every 30 seconds, so very short sessions may be missed.
        </p>
        {!playersSupported ? (
          <p className="muted">This game doesn't expose a player list, so connections can't be tracked.</p>
        ) : !players ? (
          <p className="muted">Loading…</p>
        ) : players.length === 0 ? (
          <p className="muted">No players seen yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th></th><th>Player</th><th>First seen</th><th>Last seen</th></tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.name}>
                    <td>{p.online ? <span className="status-dot" style={{ background: 'var(--green)' }} /> : ''}</td>
                    <td>{p.name}</td>
                    <td className="muted">{when(p.firstSeen)}</td>
                    <td className="muted">{when(p.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Activity</h2>
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
                  <tr><th>Time</th><th>Who</th><th>Kind</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {entries.map((e) => <ActivityRow key={e.id} e={e} />)}
                </tbody>
              </table>
            </div>
            {!done && (
              <button className="btn" style={{ marginTop: 10 }} onClick={() => loadActivity(entries[entries.length - 1].id)}>
                Load older
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
