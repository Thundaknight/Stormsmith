import type { ContainerState } from '../types';

/**
 * The decision half of the UniFi reconciler, kept free of I/O so it can be reasoned
 * about (and exercised) on its own. `sync.ts` supplies the observed container states
 * and applies whatever this returns.
 */

export function isRunning(state: ContainerState | undefined): boolean {
  return state === 'running';
}

/**
 * Records when each server was first observed not running, and forgets servers that no
 * longer exist. Mutates `offSince` in place — it is the caller's long-lived memory.
 *
 * The clock starts at first *observation*, never retroactively, which is what makes a
 * cold start safe: when Stormsmith itself restarts with a server already stopped, it
 * waits a full grace window before touching anything instead of acting on a single
 * unverified reading.
 */
export function trackOffSince(
  offSince: Map<number, number>,
  stateById: Map<number, ContainerState>,
  now: number
): void {
  for (const [serverId, state] of stateById) {
    if (isRunning(state)) offSince.delete(serverId);
    else if (!offSince.has(serverId)) offSince.set(serverId, now);
  }
  for (const id of [...offSince.keys()]) {
    if (!stateById.has(id)) offSince.delete(id);
  }
}

/**
 * What a rule's `enabled` flag should be, given every server mapped to it.
 *
 * - `true`  — enable now. Any mapped server running is enough, and there is no delay:
 *             a port must be open the moment the server can accept players.
 * - `false` — disable now. Every mapped server has been down for at least the grace window.
 * - `null`  — leave it alone: still inside the grace window, or no mapped server's state
 *             is known yet.
 *
 * The asymmetry is the whole trick. Because only the disable direction waits, a container
 * restart — back to 'running' in seconds — never reaches the point of being written, so
 * restarts never close a port without needing to be special-cased anywhere.
 */
export function desiredRuleState(
  serverIds: number[],
  stateById: Map<number, ContainerState>,
  offSince: Map<number, number>,
  graceMs: number,
  now: number
): boolean | null {
  const known = serverIds.filter((id) => stateById.has(id));
  if (known.length === 0) return null;
  // A rule shared by several servers stays open while any one of them is up.
  if (known.some((id) => isRunning(stateById.get(id)))) return true;
  const newestOff = Math.max(...known.map((id) => offSince.get(id) ?? now));
  return now - newestOff >= graceMs ? false : null;
}
