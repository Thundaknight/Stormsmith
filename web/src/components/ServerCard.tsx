import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatBytes } from '../format';
import type { GameServer, ServerAction } from '../types';
import { GAME_PRESETS } from '../types';
import StatusBadge from './StatusBadge';

interface Props {
  server: GameServer;
  onError: (message: string) => void;
}

const MAX_PLAYER_CHIPS = 10;

export default function ServerCard({ server, onError }: Props) {
  const [busy, setBusy] = useState<ServerAction | null>(null);

  const act = async (action: ServerAction) => {
    setBusy(action);
    try {
      await api.serverAction(server.id, action);
    } catch (err: any) {
      onError(`${server.name}: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const running = server.state === 'running';
  const paused = server.state === 'paused';
  const gameLabel = GAME_PRESETS[server.game]?.label || server.game;
  const players = server.players || [];
  const hasStats = running && server.cpuPercent != null;

  return (
    <div className="card server-card">
      <div className="server-card-head">
        <div>
          <Link to={`/servers/${server.id}`} className="server-name">{server.name}</Link>
          <div className="server-meta">
            <span className="game-badge">{gameLabel}</span>
            <span className="muted mono">{server.container_name}</span>
          </div>
        </div>
        <StatusBadge state={server.state} />
      </div>

      <div className="server-stats-row">
        <div className="mini-stat">
          <span className="mini-stat-label">CPU</span>
          <span className="mini-stat-value">{hasStats ? `${server.cpuPercent!.toFixed(1)}%` : '—'}</span>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-label">Memory</span>
          <span className="mini-stat-value">
            {hasStats && server.memUsageBytes != null ? formatBytes(server.memUsageBytes) : '—'}
          </span>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-label">Players</span>
          <span className="mini-stat-value">{running && server.playerCount != null ? server.playerCount : '—'}</span>
        </div>
      </div>

      {running && players.length > 0 && (
        <div className="player-chips">
          {players.slice(0, MAX_PLAYER_CHIPS).map((p) => (
            <span key={p} className="player-chip">{p}</span>
          ))}
          {players.length > MAX_PLAYER_CHIPS && (
            <span className="player-chip muted">+{players.length - MAX_PLAYER_CHIPS} more</span>
          )}
        </div>
      )}

      <div className="server-status-text muted">{server.statusText || '—'}</div>

      {server.can_control && (
        <div className="btn-row controls-row">
          <button className="btn btn-success" disabled={running || paused || !!busy} onClick={() => act('start')}>
            {busy === 'start' ? '…' : '▶ Start'}
          </button>
          <button className="btn btn-danger" disabled={(!running && !paused) || !!busy} onClick={() => act('stop')}>
            {busy === 'stop' ? '…' : '⏹ Stop'}
          </button>
          <button className="btn" disabled={!running || !!busy} onClick={() => act('restart')}>
            {busy === 'restart' ? '…' : '🔄 Restart'}
          </button>
          {paused ? (
            <button className="btn" disabled={!!busy} onClick={() => act('unpause')}>
              {busy === 'unpause' ? '…' : '⏵ Resume'}
            </button>
          ) : (
            <button className="btn" disabled={!running || !!busy} onClick={() => act('pause')}>
              {busy === 'pause' ? '…' : '⏸ Pause'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
