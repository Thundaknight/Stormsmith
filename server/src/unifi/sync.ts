import { getUnifiConfig, listAllUnifiRules, remapUnifiRuleId, renameUnifiRule } from '../db';
import { monitor } from '../monitor';
import type { ContainerState, UnifiConfig } from '../types';
import { UnifiClient } from './client';
import type { PortForwardRule } from './client';
import { desiredRuleState, trackOffSince } from './policy';

/**
 * Keeps UniFi port-forward rules in step with container state: a mapped rule is
 * enabled while its game server runs, and disabled once the server has been down
 * for the grace window.
 *
 * This reconciles from *observed* container state rather than from Stormsmith's own
 * actions, which means it also catches crashes and stops made from the Unraid UI,
 * and converges to the right state after Stormsmith itself restarts.
 *
 * Restarts never touch the port, and deliberately need no special case: enabling is
 * immediate but disabling waits out `grace_seconds` (default 90), and a container
 * restart is back to 'running' long inside that window.
 *
 * Nothing here ever runs inside a request, so an unreachable UniFi console can never
 * delay or fail a start/stop.
 */

/** Collapses bursts of monitor events into one pass. */
const DEBOUNCE_MS = 2000;
/**
 * A state change alone can't tell us the grace window has expired, and drift by hand in
 * the UniFi console produces no event at all — so also sweep on a timer.
 */
const SWEEP_MS = 60_000;

export interface AnnotatedRule {
  id: string;
  name: string;
  enabled: boolean;
  dstPort: string;
  fwd: string;
  fwdPort: string;
  proto: string;
  serverIds: number[];
}

class UnifiSync {
  private cfg: UnifiConfig | null = null;
  private client: UnifiClient | null = null;
  private timer: NodeJS.Timeout | null = null;
  private queued = false;
  private busy = false;
  /** When each server was first observed not running; cleared the moment it runs again. */
  private offSince = new Map<number, number>();
  /** serverId -> human-readable problem with its mapping, surfaced on the server's settings tab. */
  private warnings = new Map<number, string>();

  public lastError = '';
  public lastSyncAt: number | null = null;
  public connected = false;

  constructor() {
    monitor.on('change', () => this.queueReconcile());
  }

  start(): void {
    const cfg = getUnifiConfig();
    this.cfg = cfg;
    this.lastError = '';
    this.connected = false;
    this.warnings.clear();
    if (!cfg.enabled || !cfg.host) return;

    this.client = new UnifiClient(cfg);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.queueReconcile(), SWEEP_MS);
    this.timer.unref();
    this.queueReconcile();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client = null;
    this.connected = false;
  }

  restart(): void {
    this.stop();
    this.start();
  }

  isEnabled(): boolean {
    return !!this.cfg?.enabled && !!this.cfg?.host;
  }

  warningFor(serverId: number): string {
    return this.warnings.get(serverId) || '';
  }

  private queueReconcile(): void {
    if (!this.client || this.queued) return;
    this.queued = true;
    setTimeout(() => {
      this.queued = false;
      this.reconcile().catch((err) => console.error('[unifi] reconcile failed:', err?.message || err));
    }, DEBOUNCE_MS);
  }

  /** Live rule list for the settings page and the per-server picker. */
  async listRules(): Promise<AnnotatedRule[]> {
    if (!this.client) throw new Error('The UniFi integration is not enabled');
    const rules = await this.client.listPortForwards();
    const byRule = new Map<string, number[]>();
    for (const m of listAllUnifiRules()) {
      const ids = byRule.get(m.rule_id) || [];
      ids.push(m.server_id);
      byRule.set(m.rule_id, ids);
    }
    return rules.map((r) => ({
      id: r._id,
      name: r.name,
      enabled: r.enabled,
      dstPort: String(r.dst_port ?? ''),
      fwd: String(r.fwd ?? ''),
      fwdPort: String(r.fwd_port ?? ''),
      proto: String(r.proto ?? ''),
      serverIds: byRule.get(r._id) || [],
    }));
  }

  /** Forces a login + rule fetch; used by the settings page's Save & test. */
  async test(): Promise<AnnotatedRule[]> {
    if (!this.client) throw new Error('The UniFi integration is not enabled');
    this.client.reset();
    // A deliberate human action — get past the reconcile-loop back-off.
    await this.client.login(true);
    const rules = await this.listRules();
    this.connected = true;
    this.lastError = '';
    return rules;
  }

  private async reconcile(): Promise<void> {
    const client = this.client;
    const cfg = this.cfg;
    if (!client || !cfg) return;
    if (this.busy) {
      // A sweep landed on top of a running pass; the next tick picks up whatever changed.
      return;
    }

    const mappings = listAllUnifiRules();
    // Nothing mapped means nothing to do — and, importantly, not a single HTTP request.
    if (mappings.length === 0) {
      this.warnings.clear();
      return;
    }
    const statuses = monitor.getAll();
    // Monitor hasn't completed its first poll yet; acting now would be acting on no information.
    if (statuses.length === 0) return;

    this.busy = true;
    try {
      const stateById = new Map(statuses.map((s) => [s.serverId, s.state]));
      trackOffSince(this.offSince, stateById, Date.now());

      const rules = await client.listPortForwards();
      this.connected = true;
      const byId = new Map(rules.map((r) => [r._id, r]));
      const byName = new Map(rules.filter((r) => r.name).map((r) => [r.name.toLowerCase(), r]));

      // Resolve each mapping to a live rule, then group so a rule shared by two servers
      // is only closed once *both* are down.
      const targets = new Map<string, { rule: PortForwardRule; serverIds: number[] }>();
      const warnings = new Map<number, string>();
      for (const m of mappings) {
        const rule = this.resolveRule(m.rule_id, m.rule_name, byId, byName);
        if (!rule) {
          warnings.set(
            m.server_id,
            `UniFi rule "${m.rule_name || m.rule_id}" no longer exists on the controller — remap it.`
          );
          continue;
        }
        const entry = targets.get(rule._id) || { rule, serverIds: [] };
        entry.serverIds.push(m.server_id);
        targets.set(rule._id, entry);
      }
      this.warnings = warnings;

      const graceMs = Math.max(cfg.grace_seconds, 0) * 1000;
      const now = Date.now();
      let firstFailure = '';
      for (const { rule, serverIds } of targets.values()) {
        const desired = desiredRuleState(serverIds, stateById, this.offSince, graceMs, now);
        if (desired === null || desired === rule.enabled) continue;
        try {
          await client.setPortForwardEnabled(rule._id, desired);
          console.log(`[unifi] ${desired ? 'enabled' : 'disabled'} port forward '${rule.name || rule._id}'`);
        } catch (err: any) {
          // One unwritable rule must not strand every other server's ports, so note it and
          // carry on; the next sweep retries.
          const detail = `${rule.name || rule._id}: ${err?.message || err}`;
          if (!firstFailure) firstFailure = detail;
          console.error(`[unifi] failed to update '${rule.name || rule._id}':`, err?.message || err);
        }
      }

      this.lastError = firstFailure;
      this.lastSyncAt = Date.now();
    } catch (err: any) {
      // Never infer "closed" from an unreachable controller — leave the rules alone and retry.
      this.connected = false;
      this.lastError = err?.message || String(err);
      console.error('[unifi]', this.lastError);
    } finally {
      this.busy = false;
    }
  }

  /**
   * A rule deleted and recreated in UniFi comes back with a new _id, which would leave the
   * mapping silently dead — so fall back to matching on the name captured when it was mapped,
   * and repoint the mapping when that works.
   */
  private resolveRule(
    ruleId: string,
    ruleName: string,
    byId: Map<string, PortForwardRule>,
    byName: Map<string, PortForwardRule>
  ): PortForwardRule | null {
    const direct = byId.get(ruleId);
    if (direct) {
      if (direct.name && direct.name !== ruleName) renameUnifiRule(ruleId, direct.name);
      return direct;
    }
    const named = ruleName ? byName.get(ruleName.toLowerCase()) : undefined;
    if (named) {
      console.log(`[unifi] rule '${ruleName}' has a new id, repointing mapping to ${named._id}`);
      remapUnifiRuleId(ruleId, named._id);
      return named;
    }
    return null;
  }
}

export const unifiSync = new UnifiSync();
