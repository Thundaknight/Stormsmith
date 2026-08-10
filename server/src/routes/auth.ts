import { Router } from 'express';
import { hashPassword, requireAuth, signToken, verifyPassword, verifyToken } from '../auth';
import {
  countUsers, createOAuthUser, createUser, getDiscordConfig, getUserByDiscordId, getUserById, getUserByUsername,
  linkDiscordAccount, unlinkDiscordAccount,
} from '../db';
import { discordBot } from '../discord/bot';
import {
  buildAuthorizeUrl, exchangeCodeForToken, fetchDiscordIdentity, signOAuthState, verifyOAuthState,
} from '../discordOAuth';
import { asyncRoute } from './helpers';

const router = Router();

/** Whether first-run setup (creating the initial admin) is needed. */
router.get('/status', (_req, res) => {
  const cfg = getDiscordConfig();
  res.json({
    needsSetup: countUsers() === 0,
    discordOAuthEnabled: !!(cfg.oauth_enabled && cfg.oauth_client_id && cfg.oauth_redirect_uri),
  });
});

/** First-run only: create the initial admin account. This remains the only manually-created account. */
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
  if (!user || !user.password_hash) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }
  if (!verifyPassword(password || '', user.password_hash)) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }
  if (user.status !== 'active') {
    res.status(403).json({ error: 'Your account is pending administrator approval' });
    return;
  }
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/** Fuller profile info for the Account page (Discord link status, whether a password is set). */
router.get('/account', requireAuth, (req, res) => {
  const user = getUserById(req.user!.userId)!;
  res.json({
    account: {
      username: user.username,
      role: user.role,
      discord_username: user.discord_username,
      has_password: !!user.password_hash,
    },
  });
});

// ---- Discord OAuth (web login) — separate from the bot's own token ----

/** Starts a fresh Discord sign-in/sign-up. */
router.get('/discord/login', (_req, res) => {
  const cfg = getDiscordConfig();
  if (!cfg.oauth_enabled || !cfg.oauth_client_id || !cfg.oauth_client_secret || !cfg.oauth_redirect_uri) {
    res.status(400).send('Discord sign-in is not configured.');
    return;
  }
  res.redirect(buildAuthorizeUrl(cfg, signOAuthState({ purpose: 'login' })));
});

/**
 * Starts linking Discord to the currently logged-in account. Browser
 * top-level navigations can't carry an Authorization header, so the caller
 * passes their token as a query param here; it's verified once to identify
 * the user, then that identity travels through the signed `state` instead —
 * the callback itself needs no Authorization header at all.
 */
router.get('/discord/link', (req, res) => {
  const payload = verifyToken(String(req.query.token || ''));
  if (!payload) {
    res.status(401).send('Your session has expired. Please sign in again and retry linking Discord.');
    return;
  }
  const cfg = getDiscordConfig();
  if (!cfg.oauth_enabled || !cfg.oauth_client_id || !cfg.oauth_client_secret || !cfg.oauth_redirect_uri) {
    res.status(400).send('Discord sign-in is not configured.');
    return;
  }
  res.redirect(buildAuthorizeUrl(cfg, signOAuthState({ purpose: 'link', userId: payload.userId })));
});

router.get('/discord/callback', asyncRoute(async (req, res) => {
  const cfg = getDiscordConfig();
  const code = String(req.query.code || '');
  const state = code ? verifyOAuthState(String(req.query.state || '')) : null;
  if (!state) {
    res.redirect('/?discordError=' + encodeURIComponent('Your Discord sign-in request expired. Please try again.'));
    return;
  }

  let identity;
  try {
    const accessToken = await exchangeCodeForToken(cfg, code);
    identity = await fetchDiscordIdentity(accessToken);
  } catch (err: any) {
    res.redirect('/?discordError=' + encodeURIComponent(`Discord sign-in failed: ${err?.message || err}`));
    return;
  }

  if (cfg.oauth_restrict_to_guild && cfg.guild_id) {
    const isMember = await discordBot.isGuildMember(identity.id);
    if (!isMember) {
      res.redirect('/?discordError=' + encodeURIComponent('You must be a member of the Discord server to sign in here.'));
      return;
    }
  }

  const displayName = identity.global_name || identity.username;

  if (state.purpose === 'link') {
    const user = getUserById(state.userId);
    if (!user) {
      res.redirect('/?discordError=' + encodeURIComponent('Account not found.'));
      return;
    }
    const existing = getUserByDiscordId(identity.id);
    if (existing && existing.id !== user.id) {
      res.redirect('/?discordError=' + encodeURIComponent('That Discord account is already linked to a different user.'));
      return;
    }
    linkDiscordAccount(user.id, identity.id, displayName);
    res.redirect('/account?discordLinked=1');
    return;
  }

  // purpose === 'login'
  let user = getUserByDiscordId(identity.id);
  if (!user) {
    user = createOAuthUser(identity.id, displayName);
  }
  if (user.status !== 'active') {
    res.redirect('/?discordPending=1');
    return;
  }
  res.redirect('/?discordToken=' + encodeURIComponent(signToken(user)));
}));

/** Removes the Discord link from the current account (blocked if that would leave no way to sign in). */
router.post('/discord/unlink', requireAuth, (req, res) => {
  const user = getUserById(req.user!.userId)!;
  if (!user.password_hash) {
    res.status(400).json({ error: 'Set a password before unlinking Discord, or you would be locked out.' });
    return;
  }
  unlinkDiscordAccount(user.id);
  res.json({ ok: true });
});

export default router;
