export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  return `${(bytes / 2 ** (10 * i)).toFixed(1)} ${units[i]}`;
}

import type { GameServer, ServerStatusUpdate } from './types';

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
