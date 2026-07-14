import { EventEmitter } from 'events';
import { config } from './config';
import { listServers } from './db';
import { getStats, listContainers } from './docker';
import type { ContainerStats } from './docker';
import { fetchPlayers, supportsPlayerList } from './games/players';
import type { ServerStatus } from './types';

/** Player lists come from RCON, so poll them less often than container state. */
const PLAYER_POLL_MS = 30_000;

/**
 * Polls Docker for the state of every imported server's container, plus
 * CPU/memory stats for running ones and (via RCON, throttled) connected
 * players. Emits 'update' with the full status list on every poll, and
 * 'change' only when a state or player count actually changed.
 */
class StatusMonitor extends EventEmitter {
  private statuses = new Map<number, ServerStatus>();
  private timer: NodeJS.Timeout | null = null;
  private lastError = '';
  private polling = false;
  private playerCache = new Map<number, { at: number; players: string[] | null }>();

  start(): void {
    if (this.timer) return;
    const tick = () => {
      this.poll().catch(() => {});
    };
    tick();
    this.timer = setInterval(tick, config.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getAll(): ServerStatus[] {
    return [...this.statuses.values()];
  }

  get(serverId: number): ServerStatus | undefined {
    return this.statuses.get(serverId);
  }

  getLastError(): string {
    return this.lastError;
  }

  /** Force an immediate refresh (e.g. right after a start/stop action). */
  async refresh(): Promise<void> {
    await this.poll();
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.doPoll();
    } finally {
      this.polling = false;
    }
  }

  private async doPoll(): Promise<void> {
    const servers = listServers();
    let containers;
    try {
      containers = await listContainers();
      this.lastError = '';
    } catch (err: any) {
      this.lastError = `Cannot reach Docker: ${err?.message || err}`;
      return;
    }
    const byName = new Map(containers.map((c) => [c.name, c]));
    const runningServers = servers.filter((s) => byName.get(s.container_name)?.state === 'running');

    // CPU / memory for running containers, in parallel; failures just leave the fields null
    const statsMap = new Map<number, ContainerStats>();
    const statResults = await Promise.allSettled(runningServers.map((s) => getStats(s.container_name)));
    statResults.forEach((result, i) => {
      if (result.status === 'fulfilled') statsMap.set(runningServers[i].id, result.value);
    });

    // Player lists over RCON, throttled per server
    const now = Date.now();
    const playersDue = runningServers.filter(
      (s) => supportsPlayerList(s) && now - (this.playerCache.get(s.id)?.at || 0) >= PLAYER_POLL_MS
    );
    const playerResults = await Promise.allSettled(playersDue.map((s) => fetchPlayers(s)));
    playerResults.forEach((result, i) => {
      this.playerCache.set(playersDue[i].id, {
        at: now,
        players: result.status === 'fulfilled' ? result.value : null,
      });
    });

    let changed = false;
    const seen = new Set<number>();
    for (const s of servers) {
      seen.add(s.id);
      const c = byName.get(s.container_name);
      const isRunning = c?.state === 'running';
      if (!isRunning) this.playerCache.delete(s.id);
      const stats = statsMap.get(s.id);
      const players = isRunning ? this.playerCache.get(s.id)?.players ?? null : null;
      const next: ServerStatus = {
        serverId: s.id,
        name: s.name,
        game: s.game,
        containerName: s.container_name,
        state: c ? c.state : 'not_found',
        statusText: c ? c.statusText : 'Container not found',
        cpuPercent: stats?.cpuPercent ?? null,
        memUsageBytes: stats?.memUsageBytes ?? null,
        memLimitBytes: stats?.memLimitBytes ?? null,
        players,
        playerCount: players ? players.length : null,
      };
      const prev = this.statuses.get(s.id);
      if (!prev || prev.state !== next.state || prev.name !== next.name || prev.playerCount !== next.playerCount) {
        changed = true;
      }
      this.statuses.set(s.id, next);
    }
    for (const id of [...this.statuses.keys()]) {
      if (!seen.has(id)) {
        this.statuses.delete(id);
        this.playerCache.delete(id);
        changed = true;
      }
    }

    this.emit('update', this.getAll());
    if (changed) this.emit('change', this.getAll());
  }
}

export const monitor = new StatusMonitor();
