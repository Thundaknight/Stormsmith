import { listServers } from './db';
import { performAction } from './docker';
import { monitor } from './monitor';
import { sendBroadcast } from './rcon';

/**
 * Scheduled restarts, with in-game RCON warnings broadcast 30, 5, and
 * 1 minute(s) beforehand. Two modes per server:
 * - 'daily': restart once a day at restart_time
 * - 'interval': restart every restart_interval_hours, with restart_time as
 *   the first restart of each day (e.g. 04:00 every 6h -> 04:00, 10:00,
 *   16:00, 22:00, then 04:00 again the next day)
 */

const TICK_MS = 30_000;
const WARN_MINUTES = [30, 5, 1];
/** If the target time passed more than this long ago, schedule for tomorrow. */
const GRACE_MS = 10 * 60_000;

interface Occurrence {
  key: string;
  warned: Set<number>;
  restarted: boolean;
}

const occurrences = new Map<number, Occurrence>();

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

/** The next (or just-passed, within grace) restart time for a server. */
function nextTarget(now: Date, time: string, mode: string, intervalHours: number): Date | null {
  const anchor = anchorAt(now, time);
  if (!anchor) return null;

  if (mode === 'interval') {
    const hours = Math.min(Math.max(Math.floor(intervalHours) || 0, 1), 24);
    const stepMs = hours * 3_600_000;
    const dayMs = 86_400_000;
    // Occurrences restart from the anchor each day, so times stay predictable
    for (let dayOffset = -1; dayOffset <= 1; dayOffset++) {
      const base = anchor.getTime() + dayOffset * dayMs;
      for (let t = base; t < base + dayMs; t += stepMs) {
        if (t >= now.getTime() - GRACE_MS) return new Date(t);
      }
    }
    return null;
  }

  // daily
  if (now.getTime() > anchor.getTime() + GRACE_MS) anchor.setDate(anchor.getDate() + 1);
  return anchor;
}

async function tick(): Promise<void> {
  const now = new Date();
  for (const server of listServers()) {
    if (!server.restart_enabled || !server.restart_time) {
      occurrences.delete(server.id);
      continue;
    }
    // Only restart (and warn) servers that are actually running
    if (monitor.get(server.id)?.state !== 'running') continue;

    const target = nextTarget(now, server.restart_time, server.restart_mode, server.restart_interval_hours);
    if (!target) continue;
    const key = String(target.getTime());
    let occ = occurrences.get(server.id);
    if (!occ || occ.key !== key) {
      occ = { key, warned: new Set(), restarted: false };
      occurrences.set(server.id, occ);
    }

    const remainMs = target.getTime() - now.getTime();
    const remainMin = remainMs / 60_000;

    for (const warn of WARN_MINUTES) {
      // The window (warn-2, warn] tolerates tick jitter without double- or late-firing
      if (!occ.warned.has(warn) && remainMin <= warn && remainMin > warn - 2) {
        occ.warned.add(warn);
        sendBroadcast(server, `Server will restart in ${warn} minute${warn === 1 ? '' : 's'}`).catch(() => {});
      }
    }

    if (!occ.restarted && remainMs <= 0) {
      occ.restarted = true;
      console.log(`[scheduler] scheduled restart of '${server.name}' (${server.container_name})`);
      try {
        await performAction(server.container_name, 'restart');
        await monitor.refresh();
      } catch (err: any) {
        console.error(`[scheduler] restart of '${server.name}' failed:`, err?.message || err);
      }
    }
  }
}

export function startScheduler(): void {
  setInterval(() => {
    tick().catch((err) => console.error('[scheduler] tick failed:', err));
  }, TICK_MS).unref();
}
