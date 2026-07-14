import { Router } from 'express';
import { hashPassword, requireAuth, signToken, verifyPassword } from '../auth';
import { countUsers, createUser, getUserByUsername } from '../db';

const router = Router();

/** Whether first-run setup (creating the initial admin) is needed. */
router.get('/status', (_req, res) => {
  res.json({ needsSetup: countUsers() === 0 });
});

/** First-run only: create the initial admin account. */
router.post('/setup', (req, res) => {
  if (countUsers() > 0) {
    res.status(403).json({ error: 'Setup has already been completed' });
    return;
  }
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 8) {
    res.status(400).json({ error: 'Username and a password of at least 8 characters are required' });
    return;
  }
  const user = createUser(username, hashPassword(password), 'admin');
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = username ? getUserByUsername(username) : undefined;
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
