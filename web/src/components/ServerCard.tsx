import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { GameServer, ServerAction } from '../types';
import { GAME_PRESETS } from '../types';
import StatusBadge from './StatusBadge';

interface Props {
  server: GameServer;
  onError: (message: string) => void;
}

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
      <div className="muted server-status-text">{server.statusText || '—'}</div>
      {server.can_control && (
        <div className="btn-row">
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
