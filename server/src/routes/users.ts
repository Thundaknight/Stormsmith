import { Router } from 'express';
import { hashPassword, requireAdmin, requireAuth } from '../auth';
import {
  createUser, deleteUser, getUserById, listPermissionsForUser, listUsers,
  setPermissionsForUser, updateUser,
} from '../db';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/', (_req, res) => {
  res.json({
    users: listUsers().map((u) => ({ id: u.id, username: u.username, role: u.role, created_at: u.created_at })),
  });
});

router.post('/', (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password || password.length < 8) {
    res.status(400).json({ error: 'Username and a password of at least 8 characters are required' });
    return;
  }
  if (role !== 'admin' && role !== 'user') {
    res.status(400).json({ error: "Role must be 'admin' or 'user'" });
    return;
  }
  try {
    const user = createUser(username, hashPassword(password), role);
    res.json({ user: { id: user.id, username: user.username, role: user.role } });
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) {
      res.status(409).json({ error: 'That username is already taken' });
      return;
    }
    throw err;
  }
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
  const updated = getUserById(id)!;
  res.json({ user: { id: updated.id, username: updated.username, role: updated.role } });
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
