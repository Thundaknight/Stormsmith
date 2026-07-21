import { listServers } from './db';
import { performAction } from './docker';
import { monitor } from './monitor';
import { sendBroadcast } from './rcon';
import type { GameServer } from './types';

/**
 * Scheduled restarts, with in-game RCON warnings broadcast 30, 5, and
 * 1 minute(s) beforehand. Two modes per server:
 * - 'daily': restart once a day at restart_time
 * - 'interval': restart every restart_interval_hours, with restart_time as
 *   the first restart of each day (e.g. 04:00 every 6h -> 04:00, 10:00,
 *   16:00, 22:00, then 04:00 again the next day)
 *
 * Each server's next restart is armed once and then advanced by a fixed
 * period after it fires, rather than recomputed from "now" every tick —
 * that keeps a manual "delay 30 minutes" override stable across ticks
 * without fighting the day-rollover logic used to arm the first occurrence.
 */

const TICK_MS = 30_000;
const WARN_MINUTES = [30, 5, 1];
/** If the target time passed more than this long ago, arm for tomorrow instead. */
const GRACE_MS = 10 * 60_000;
const DELAY_MS = 30 * 60_000;
/** Skip a scheduled restart if the container already restarted this recently before it. */
const SKIP_IF_RESTARTED_WITHIN_MS = 60 * 60_000;

interface ServerSchedule {
  targetAt: number;
  warned: Set<number>;
  /** restart_mode|restart_time|restart_interval_hours — re-arms the schedule when this changes. */
  signature: string;
}

const schedules = new Map<number, ServerSchedule>();

function anchorAt(base: Date, time: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  if (hours > 23 || minutes > 59) return null;
  const anchor = new Date(base);
  anchor.setHours(hours, minutes, 0, 0);
  return anchor;
}

function intervalHoursOf(server: GameServer): number {
  return Math.min(Math.max(Math.floor(server.restart_interval_hours) || 0, 1), 24);
}

/** The period between occurrences, used to advance the schedule after it fires. */
function periodMs(server: GameServer): number {
  return server.restart_mode === 'interval' ? intervalHoursOf(server) * 3_600_000 : 86_400_000;
}

/** The first occurrence at/after `now`, used only to arm a fresh (or freshly-edited) schedule. */
function firstOccurrenceAt(now: Date, server: GameServer): Date | null {
  const anchor = anchorAt(now, server.restart_time);
  if (!anchor) return null;

  if (server.restart_mode === 'interval') {
    const stepMs = intervalHoursOf(server) * 3_600_000;
    const dayMs = 86_400_000;
    for (let dayOffset = -1; dayOffset <= 1; dayOffset++) {
      const base = anchor.getTime() + dayOffset * dayMs;
      for (let t = base; t < base + dayMs; t += stepMs) {
        if (t >= now.getTime() - GRACE_MS) return new Date(t);
      }
    }
    return null;
  }

  if (now.getTime() > anchor.getTime() + GRACE_MS) anchor.setDate(anchor.getDate() + 1);
  return anchor;
}

function signatureOf(server: GameServer): string {
  return `${server.restart_mode}|${server.restart_time}|${server.restart_interval_hours}`;
}

async function tick(): Promise<void> {
  const now = new Date();
  const nowMs = now.getTime();

  for (const server of listServers()) {
    if (!server.restart_enabled || !server.restart_time) {
      schedules.delete(server.id);
      continue;
    }

    const signature = signatureOf(server);
    let sched = schedules.get(server.id);
    if (!sched || sched.signature !== signature) {
      const first = firstOccurrenceAt(now, server);
      if (!first) {
        schedules.delete(server.id);
        continue;
      }
      sched = { targetAt: first.getTime(), warned: new Set(), signature };
      schedules.set(server.id, sched);
    }

    const running = monitor.get(server.id)?.state === 'running';
    const remainMin = (sched.targetAt - nowMs) / 60_000;

    if (running) {
      for (const warn of WARN_MINUTES) {
        // The window (warn-2, warn] tolerates tick jitter without double- or late-firing
        if (!sched.warned.has(warn) && remainMin <= warn && remainMin > warn - 2) {
          sched.warned.add(warn);
          sendBroadcast(server, `Server will restart in ${warn} minute${warn === 1 ? '' : 's'}`).catch(() => {});
        }
      }
    }

    if (nowMs >= sched.targetAt) {
      if (!running) {
        console.log(`[scheduler] '${server.name}' is not running at its scheduled restart time — skipping`);
      } else {
        const startedAt = monitor.get(server.id)?.startedAt;
        const startedMs = startedAt ? Date.parse(startedAt) : NaN;
        const recentlyRestarted = Number.isFinite(startedMs) && sched.targetAt - startedMs < SKIP_IF_RESTARTED_WITHIN_MS;
        if (recentlyRestarted) {
          console.log(
            `[scheduler] skipping restart of '${server.name}' — it already restarted at ${new Date(startedMs).toISOString()}, within an hour of the scheduled time`
          );
        } else {
          console.log(`[scheduler] scheduled restart of '${server.name}' (${server.container_name})`);
          try {
            await performAction(server.container_name, 'restart');
            await monitor.refresh();
          } catch (err: any) {
            console.error(`[scheduler] restart of '${server.name}' failed:`, err?.message || err);
          }
        }
      }
      // Advance to the next occurrence immediately so the schedule is ready for the next tick.
      // periodMs is at least 1 hour, comfortably ahead of "now", so this can't refire this tick.
      sched.targetAt += periodMs(server);
      sched.warned = new Set();
    }
  }
}

export function startScheduler(): void {
  setInterval(() => {
    tick().catch((err) => console.error('[scheduler] tick failed:', err));
  }, TICK_MS).unref();
}

/** Pushes a server's next scheduled restart back by 30 minutes. Returns the new time, or null if none is scheduled. */
export function delayScheduledRestart(serverId: number): number | null {
  const sched = schedules.get(serverId);
  if (!sched) return null;
  sched.targetAt += DELAY_MS;
  sched.warned = new Set();
  return sched.targetAt;
}

/** The epoch ms of a server's next scheduled restart, or null if none is scheduled. */
export function getNextScheduledRestart(serverId: number): number | null {
  return schedules.get(serverId)?.targetAt ?? null;
}
