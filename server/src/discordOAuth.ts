import jwt from 'jsonwebtoken';
import { config } from './config';
import type { DiscordConfig } from './types';

/**
 * Discord OAuth2 (Authorization Code grant) for signing into the Stormsmith
 * web app itself — separate from the bot's own token, which authenticates
 * the bot user for the status embed and slash commands.
 *
 * The `state` param doubles as CSRF protection and an intent carrier: it's a
 * short-lived JWT (signed with the same secret as session tokens) so the
 * callback can distinguish a fresh login/signup from a "link Discord to my
 * existing account" request without needing a server-side session store.
 */

export type OAuthState = { purpose: 'login' } | { purpose: 'link'; userId: number };

export function signOAuthState(payload: OAuthState): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '10m' });
}

export function verifyOAuthState(state: string): OAuthState | null {
  try {
    return jwt.verify(state, config.jwtSecret) as OAuthState;
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(cfg: DiscordConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.oauth_client_id,
    redirect_uri: cfg.oauth_redirect_uri,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(cfg: DiscordConfig, code: string): Promise<string> {
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.oauth_client_id,
      client_secret: cfg.oauth_client_secret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.oauth_redirect_uri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord token exchange failed (HTTP ${res.status})`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Discord did not return an access token');
  return data.access_token;
}

export interface DiscordIdentity {
  id: string;
  username: string;
  global_name: string | null;
}

export async function fetchDiscordIdentity(accessToken: string): Promise<DiscordIdentity> {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch Discord identity (HTTP ${res.status})`);
  return res.json();
}
