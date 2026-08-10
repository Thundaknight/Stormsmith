import { Router } from 'express';
import { hashPassword, requireAdmin, requireAuth } from '../auth';
import {
  approveUser, deleteUser, getUserById, listPermissionsForUser, listUsers,
  setPermissionsForUser, updateUser,
} from '../db';

const router = Router();
router.use(requireAuth, requireAdmin);

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

/** Approves a pending Discord sign-up so it can actually log in. */
router.post('/:id/approve', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = getUserById(id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  approveUser(id);
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
    }))
  );
  res.json({ permissions: listPermissionsForUser(id) });
});

export default router;
