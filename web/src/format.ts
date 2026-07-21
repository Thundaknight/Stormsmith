export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  return `${(bytes / 2 ** (10 * i)).toFixed(1)} ${units[i]}`;
}

import type { GameServer, ServerStatusUpdate } from './types';

/** "in 2h 15m" / "in 45m" / "45m ago", for a countdown-style timestamp. */
export function formatRelative(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return '';
  const mins = Math.round(Math.abs(ms) / 60_000);
  const hours = Math.floor(mins / 60);
  const label = hours > 0 ? `${hours}h ${mins % 60}m` : `${mins}m`;
  return ms >= 0 ? `in ${label}` : `${label} ago`;
}

/** Merges live WebSocket status fields into a server object. */
export function mergeLive(server: GameServer, live?: ServerStatusUpdate): GameServer {
  if (!live) return server;
  return {
    ...server,
    state: live.state,
    statusText: live.statusText,
    cpuPercent: live.cpuPercent,
    memUsageBytes: live.memUsageBytes,
    memLimitBytes: live.memLimitBytes,
    playerCount: live.playerCount,
    players: live.players,
    startedAt: live.startedAt,
  };
}
