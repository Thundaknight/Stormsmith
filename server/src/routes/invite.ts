import { Router } from 'express';
import { hashPassword, signToken } from '../auth';
import { createUser, deleteInviteLink, getInviteLink, setPermissionsForUser } from '../db';

/**
 * Publicly accessible (no login) — lets someone create a Stormsmith account
 * without Discord. Possessing the token is the invitation; the role and
 * permissions it grants were decided by the admin when the link was made.
 * Deliberately not mounted under requireAuth.
 */
const router = Router();

router.get('/:token', (req, res) => {
  const invite = getInviteLink(req.params.token);
  if (!invite) {
    res.status(404).json({ error: 'This invite link is invalid or has expired.' });
    return;
  }
  res.json({ role: invite.role });
});

router.post('/:token', (req, res) => {
  const invite = getInviteLink(req.params.token);
  if (!invite) {
    res.status(404).json({ error: 'This invite link is invalid or has expired.' });
    return;
  }
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || /\s/.test(username)) {
    res.status(400).json({ error: 'Username is required and cannot contain spaces' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  let user;
  try {
    user = createUser(username, hashPassword(password), invite.role);
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) {
      res.status(409).json({ error: 'That username is already taken' });
      return;
    }
    throw err;
  }

  if (invite.role === 'user') {
    try {
      const perms = JSON.parse(invite.permissions);
      if (Array.isArray(perms) && perms.length > 0) setPermissionsForUser(user.id, perms);
    } catch {
      // Malformed permissions JSON shouldn't block account creation — the account just starts with none.
    }
  }

  deleteInviteLink(invite.token);
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
});

export default router;
