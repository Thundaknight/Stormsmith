import crypto from 'crypto';
import { Router } from 'express';
import { hashPassword, requireAdmin, requireAuth } from '../auth';
import {
  approveUser, createInviteLink, deleteInviteLink, deleteUser, getUserById, listInviteLinks,
  listPermissionsForUser, listUsers, setPermissionsForUser, updateUser,
} from '../db';

const router = Router();
router.use(requireAuth, requireAdmin);

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Lets an admin invite someone who doesn't use Discord: generates a
 * single-use link (role and, for a regular user, per-server access are
 * decided now, same as approving a Discord sign-up) that the invitee visits
 * to pick their own username and password. Expires in 24h or as soon as
 * it's redeemed, whichever comes first.
 */
router.post('/invites', (req, res) => {
  const { role, permissions } = req.body || {};
  if (role !== undefined && role !== 'admin' && role !== 'user') {
    res.status(400).json({ error: "Role must be 'admin' or 'user'" });
    return;
  }
  const effectiveRole = role === 'admin' ? 'admin' : 'user';
  const perms =
    effectiveRole === 'user' && Array.isArray(permissions)
      ? permissions.map((p: any) => ({
          server_id: parseInt(p.server_id, 10),
          can_view: !!p.can_view,
          can_control: !!p.can_control,
          can_rcon: !!p.can_rcon,
          can_configure: !!p.can_configure,
        }))
      : [];
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + INVITE_TTL_MS;
  createInviteLink({
    token, role: effectiveRole, permissions: JSON.stringify(perms), created_by: req.user!.userId, expires_at: expiresAt,
  });
  res.json({ token, role: effectiveRole, expiresAt: new Date(expiresAt).toISOString() });
});

router.get('/invites', (_req, res) => {
  res.json({
    invites: listInviteLinks().map((i) => ({
      token: i.token, role: i.role, expiresAt: new Date(i.expires_at).toISOString(), createdAt: i.created_at,
    })),
  });
});

router.delete('/invites/:token', (req, res) => {
  deleteInviteLink(req.params.token);
  res.json({ ok: true });
});

function publicUser(u: ReturnType<typeof listUsers>[number]) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    status: u.status,
    discord_username: u.discord_username,
    has_password: !!u.password_hash,
    created_at: u.created_at,
  };
}

/**
 * New accounts are created only two ways: the initial admin via first-run
 * setup, and everyone else by signing up with Discord (landing here as
 * status: 'pending' until an admin approves them below).
 */
router.get('/', (_req, res) => {
  res.json({ users: listUsers().map(publicUser) });
});

/**
 * Approves a pending Discord sign-up so it can actually log in — this doubles as the
 * onboarding step: the admin picks a role and, for a regular user, per-server access
 * right here, rather than approving blind and configuring permissions separately.
 */
router.post('/:id/approve', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = getUserById(id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const { role, permissions } = req.body || {};
  if (role !== undefined && role !== 'admin' && role !== 'user') {
    res.status(400).json({ error: "Role must be 'admin' or 'user'" });
    return;
  }
  approveUser(id);
  if (role !== undefined) updateUser(id, { role });
  const effectiveRole = role ?? user.role;
  if (effectiveRole === 'user' && Array.isArray(permissions)) {
    setPermissionsForUser(
      id,
      permissions.map((p: any) => ({
        server_id: parseInt(p.server_id, 10),
        can_view: !!p.can_view,
        can_control: !!p.can_control,
        can_rcon: !!p.can_rcon,
        can_configure: !!p.can_configure,
      }))
    );
  }
  res.json({ user: publicUser(getUserById(id)!) });
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = getUserById(id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const { password, role } = req.body || {};
  if (role !== undefined && role !== 'admin' && role !== 'user') {
    res.status(400).json({ error: "Role must be 'admin' or 'user'" });
    return;
  }
  if (role === 'user' && user.role === 'admin' && req.user!.userId === id) {
    res.status(400).json({ error: 'You cannot demote your own account' });
    return;
  }
  if (password !== undefined && password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  updateUser(id, {
    password_hash: password !== undefined ? hashPassword(password) : undefined,
    role,
  });
  res.json({ user: publicUser(getUserById(id)!) });
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user!.userId) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }
  deleteUser(id);
  res.json({ ok: true });
});

router.get('/:id/permissions', (req, res) => {
  res.json({ permissions: listPermissionsForUser(parseInt(req.params.id, 10)) });
});

router.put('/:id/permissions', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!getUserById(id)) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const perms = req.body?.permissions;
  if (!Array.isArray(perms)) {
    res.status(400).json({ error: 'permissions must be an array' });
    return;
  }
  setPermissionsForUser(
    id,
    perms.map((p: any) => ({
      server_id: parseInt(p.server_id, 10),
      can_view: !!p.can_view,
      can_control: !!p.can_control,
      can_rcon: !!p.can_rcon,
      can_configure: !!p.can_configure,
    }))
  );
  res.json({ permissions: listPermissionsForUser(id) });
});

export default router;
