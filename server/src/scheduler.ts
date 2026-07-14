import { listServers } from './db';
import { performAction } from './docker';
import { monitor } from './monitor';
import { sendBroadcast } from './rcon';

/**
 * Daily scheduled restarts. Servers with restart_enabled get restarted at
 * restart_time (server local time), with in-game RCON warnings broadcast
 * 30, 5, and 1 minute(s) beforehand.
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

function nextTarget(now: Date, time: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  if (hours > 23 || minutes > 59) return null;
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (now.getTime() > target.getTime() + GRACE_MS) target.setDate(target.getDate() + 1);
  return target;
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

    const target = nextTarget(now, server.restart_time);
    if (!target) continue;
    const key = `${target.toDateString()} ${server.restart_time}`;
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
