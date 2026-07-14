import { EventEmitter } from 'events';
import { config } from './config';
import { listServers } from './db';
import { listContainers } from './docker';
import type { ServerStatus } from './types';

/**
 * Polls Docker for the state of every imported server's container.
 * Emits 'update' with the full status list on every poll, and 'change'
 * only when at least one server's state actually changed.
 */
class StatusMonitor extends EventEmitter {
  private statuses = new Map<number, ServerStatus>();
  private timer: NodeJS.Timeout | null = null;
  private lastError = '';

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

    let changed = false;
    const seen = new Set<number>();
    for (const s of servers) {
      seen.add(s.id);
      const c = byName.get(s.container_name);
      const next: ServerStatus = {
        serverId: s.id,
        name: s.name,
        game: s.game,
        containerName: s.container_name,
        state: c ? c.state : 'not_found',
        statusText: c ? c.statusText : 'Container not found',
      };
      const prev = this.statuses.get(s.id);
      if (!prev || prev.state !== next.state || prev.name !== next.name) changed = true;
      this.statuses.set(s.id, next);
    }
    for (const id of [...this.statuses.keys()]) {
      if (!seen.has(id)) {
        this.statuses.delete(id);
        changed = true;
      }
    }

    this.emit('update', this.getAll());
    if (changed) this.emit('change', this.getAll());
  }
}

export const monitor = new StatusMonitor();
