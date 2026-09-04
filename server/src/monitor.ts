import { EventEmitter } from 'events';
import { config } from './config';
import { listServers, logServerActivity, touchPlayersSeen } from './db';
import { getStartedAt, getStats, listContainers } from './docker';
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
  /** Last known real player list per server, for connect/disconnect diffing. */
  private prevPlayers = new Map<number, string[]>();

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

    // Container start times for uptime; fetched fresh every poll so a fast restart
    // (one that completes within a single poll interval) is never missed and left stale
    const startedAtMap = new Map<number, string | null>();
    const startedResults = await Promise.allSettled(runningServers.map((s) => getStartedAt(s.container_name)));
    startedResults.forEach((result, i) => {
      startedAtMap.set(runningServers[i].id, result.status === 'fulfilled' ? result.value : null);
    });

    // Player lists over RCON, throttled per server
    const now = Date.now();
    const playersDue = runningServers.filter(
      (s) => supportsPlayerList(s) && now - (this.playerCache.get(s.id)?.at || 0) >= PLAYER_POLL_MS
    );
    const playerResults = await Promise.allSettled(playersDue.map((s) => fetchPlayers(s)));
    playerResults.forEach((result, i) => {
      const server = playersDue[i];
      const players = result.status === 'fulfilled' ? result.value : null;
      this.playerCache.set(server.id, { at: now, players });
      // A failed poll is "no information" — never let it read as everyone leaving.
      if (players) this.diffPlayers(server.id, players);
    });

    let changed = false;
    const seen = new Set<number>();
    for (const s of servers) {
      seen.add(s.id);
      const c = byName.get(s.container_name);
      const isRunning = c?.state === 'running';
      if (!isRunning) {
        this.playerCache.delete(s.id);
        // A stopped container's players are gone; the stop itself is logged as an action.
        this.prevPlayers.delete(s.id);
      }
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
        gamePort: s.game_port,
        startedAt: isRunning ? startedAtMap.get(s.id) ?? null : null,
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

    for (const id of [...this.prevPlayers.keys()]) {
      if (!seen.has(id)) this.prevPlayers.delete(id);
    }

    this.emit('update', this.getAll());
    if (changed) this.emit('change', this.getAll());
  }

  /**
   * Records connect/disconnect events and roster last-seen from one player-list poll.
   * `current` is always a real array here — a failed poll is skipped by the caller.
   */
  private diffPlayers(serverId: number, current: string[]): void {
    const prev = this.prevPlayers.get(serverId);
    this.prevPlayers.set(serverId, current);
    try {
      touchPlayersSeen(serverId, current);
      if (!prev) return; // first poll for this server this session — seed without events
      const prevSet = new Set(prev);
      const curSet = new Set(current);
      for (const name of current) {
        if (!prevSet.has(name)) {
          logServerActivity({ server_id: serverId, kind: 'player', source: 'monitor', detail: 'connected', target: name });
        }
      }
      for (const name of prev) {
        if (!curSet.has(name)) {
          logServerActivity({ server_id: serverId, kind: 'player', source: 'monitor', detail: 'disconnected', target: name });
        }
      }
    } catch (err: any) {
      console.error('[monitor] player diff failed:', err?.message || err);
    }
  }
}

export const monitor = new StatusMonitor();
