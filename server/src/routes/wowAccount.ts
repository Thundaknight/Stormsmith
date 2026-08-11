import { Router } from 'express';
import { deleteWowAccountLink, getServerById, getWowAccountLink } from '../db';
import { sendRconCommand } from '../rcon';
import { asyncRoute } from './helpers';

/**
 * Publicly accessible (no login) — a player who clicks their link proves
 * their identity by possessing the token, not by having a Stormsmith
 * account. Covers both link purposes: creating a new AzerothCore account
 * (the player picks their own username) and resetting an existing one's
 * password (the username was fixed when the admin generated the link).
 * Deliberately not mounted under requireAuth.
 */
const router = Router();

// Account names go straight into a SOAP GM command, so keep them to a safe, unambiguous charset.
const USERNAME_RE = /^[A-Za-z0-9]{3,16}$/;

router.get('/:token', (req, res) => {
  const link = getWowAccountLink(req.params.token);
  if (!link) {
    res.status(404).json({ error: 'This link is invalid or has expired.' });
    return;
  }
  const server = getServerById(link.server_id);
  if (!server) {
    res.status(404).json({ error: 'This link is invalid or has expired.' });
    return;
  }
  res.json({ purpose: link.purpose, username: link.username, serverName: server.name });
});

router.post('/:token', asyncRoute(async (req, res) => {
  const link = getWowAccountLink(req.params.token);
  if (!link) {
    res.status(404).json({ error: 'This link is invalid or has expired.' });
    return;
  }
  const server = getServerById(link.server_id);
  if (!server || server.game !== 'azerothcore') {
    res.status(404).json({ error: 'This link is invalid or has expired.' });
    return;
  }
  const password = String(req.body?.password || '');
  if (password.length < 6 || password.length > 32) {
    res.status(400).json({ error: 'Password must be 6-32 characters.' });
    return;
  }

  if (link.purpose === 'create') {
    const username = String(req.body?.username || '').trim();
    if (!USERNAME_RE.test(username)) {
      res.status(400).json({ error: 'Username must be 3-16 letters/numbers with no spaces or symbols.' });
      return;
    }
    const response = await sendRconCommand(server, `.account create ${username} ${password}`);
    const text = response.trim();
    if (/already\s*exist/i.test(text)) {
      res.status(409).json({ error: 'That username is already taken — try a different one.' });
      return;
    }
    if (link.gm_level > 0) {
      await sendRconCommand(server, `.account set gmlevel ${username} ${link.gm_level} -1`);
    }
    deleteWowAccountLink(link.token);
    res.json({ ok: true });
    return;
  }

  // purpose === 'reset'
  const response = await sendRconCommand(server, `.account set password ${link.username} ${password} ${password}`);
  const text = response.trim();
  if (/not\s*exist/i.test(text)) {
    res.status(400).json({ error: 'That account no longer exists.' });
    return;
  }
  deleteWowAccountLink(link.token);
  res.json({ ok: true });
}));

export default router;
