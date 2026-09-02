import { Router } from 'express';
import { requireAdmin, requireAuth } from '../auth';
import { getUnifiConfig, updateUnifiConfig } from '../db';
import { unifiSync } from '../unifi/sync';
import { asyncRoute } from './helpers';

const router = Router();
router.use(requireAuth, requireAdmin);

function maskedConfig() {
  const cfg = getUnifiConfig();
  return {
    ...cfg,
    password: cfg.password ? '••••••••' : '',
    password_set: !!cfg.password,
    connected: unifiSync.connected,
    last_error: unifiSync.lastError,
    last_sync: unifiSync.lastSyncAt ? new Date(unifiSync.lastSyncAt).toISOString() : null,
  };
}

router.get('/config', (_req, res) => {
  res.json({ config: maskedConfig() });
});

router.put('/config', asyncRoute(async (req, res) => {
  const b = req.body || {};
  updateUnifiConfig({
    enabled: b.enabled !== undefined ? (b.enabled ? 1 : 0) : undefined,
    host: typeof b.host === 'string' ? b.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : undefined,
    port: b.port !== undefined ? Math.min(Math.max(parseInt(b.port, 10) || 443, 1), 65535) : undefined,
    site: typeof b.site === 'string' ? b.site.trim() || 'default' : undefined,
    username: typeof b.username === 'string' ? b.username.trim() : undefined,
    // Only overwrite the password if the client actually sent a new one (not the mask)
    password: typeof b.password === 'string' && !b.password.includes('•') ? b.password : undefined,
    verify_tls: b.verify_tls !== undefined ? (b.verify_tls ? 1 : 0) : undefined,
    grace_seconds:
      b.grace_seconds !== undefined ? Math.min(Math.max(parseInt(b.grace_seconds, 10) || 90, 0), 3600) : undefined,
  });
  unifiSync.restart();

  // Report straight away whether the new settings actually work, like the Discord page does.
  if (unifiSync.isEnabled()) {
    try {
      await unifiSync.test();
    } catch (err: any) {
      unifiSync.lastError = err?.message || String(err);
    }
  }
  res.json({ config: maskedConfig() });
}));

/** Re-check the connection without changing config. */
router.post('/test', asyncRoute(async (_req, res) => {
  if (!unifiSync.isEnabled()) {
    res.status(400).json({ error: 'The UniFi integration is not enabled' });
    return;
  }
  try {
    const rules = await unifiSync.test();
    res.json({ ok: true, rules, config: maskedConfig() });
  } catch (err: any) {
    unifiSync.lastError = err?.message || String(err);
    res.json({ ok: false, error: unifiSync.lastError, rules: [], config: maskedConfig() });
  }
}));

/** Live port-forward rules, for the settings table and the per-server picker. */
router.get('/rules', asyncRoute(async (_req, res) => {
  if (!unifiSync.isEnabled()) {
    res.json({ rules: [], enabled: false });
    return;
  }
  res.json({ rules: await unifiSync.listRules(), enabled: true });
}));

export default router;
