import { Router } from 'express';
import { deleteWowPasswordReset, getServerById, getWowPasswordReset } from '../db';
import { sendRconCommand } from '../rcon';
import { asyncRoute } from './helpers';

/**
 * Publicly accessible (no login) — a player who clicks their reset link
 * proves their identity by possessing the token, not by having a Stormsmith
 * account. Deliberately not mounted under requireAuth.
 */
const router = Router();

router.get('/:token', (req, res) => {
  const reset = getWowPasswordReset(req.params.token);
  if (!reset) {
    res.status(404).json({ error: 'This link is invalid or has expired.' });
    return;
  }
  const server = getServerById(reset.server_id);
  if (!server) {
    res.status(404).json({ error: 'This link is invalid or has expired.' });
    return;
  }
  res.json({ username: reset.username, serverName: server.name });
});

router.post('/:token', asyncRoute(async (req, res) => {
  const reset = getWowPasswordReset(req.params.token);
  if (!reset) {
    res.status(404).json({ error: 'This link is invalid or has expired.' });
    return;
  }
  const server = getServerById(reset.server_id);
  if (!server || server.game !== 'azerothcore') {
    res.status(404).json({ error: 'This link is invalid or has expired.' });
    return;
  }
  const password = String(req.body?.password || '');
  if (password.length < 6 || password.length > 32) {
    res.status(400).json({ error: 'Password must be 6-32 characters.' });
    return;
  }
  const response = await sendRconCommand(server, `.account set password ${reset.username} ${password} ${password}`);
  const text = response.trim();
  if (/not\s*exist/i.test(text)) {
    res.status(400).json({ error: 'That account no longer exists.' });
    return;
  }
  deleteWowPasswordReset(reset.token);
  res.json({ ok: true });
}));

export default router;
