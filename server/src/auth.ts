import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config';
import { getPermission, getUserById } from './db';
import type { AuthTokenPayload, User } from './types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signToken(user: User): string {
  const payload: AuthTokenPayload = { userId: user.id, username: user.username, role: user.role };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.tokenTtl } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as AuthTokenPayload;
  } catch {
    return null;
  }
}

/** Requires a valid bearer token; also refreshes role from the DB so role changes apply immediately. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const user = getUserById(payload.userId);
  if (!user) {
    res.status(401).json({ error: 'User no longer exists' });
    return;
  }
  req.user = { userId: user.id, username: user.username, role: user.role };
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

export type PermissionKind = 'view' | 'control' | 'rcon';

export function userCan(user: AuthTokenPayload, serverId: number, kind: PermissionKind): boolean {
  if (user.role === 'admin') return true;
  const perm = getPermission(user.userId, serverId);
  if (!perm) return false;
  if (kind === 'view') return !!(perm.can_view || perm.can_control || perm.can_rcon);
  if (kind === 'control') return !!perm.can_control;
  return !!perm.can_rcon;
}

/** Express middleware factory: requires the given permission on the server in :id. */
export function requireServerPermission(kind: PermissionKind) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const serverId = parseInt(req.params.id, 10);
    if (Number.isNaN(serverId)) {
      res.status(400).json({ error: 'Invalid server id' });
      return;
    }
    if (!req.user || !userCan(req.user, serverId, kind)) {
      res.status(403).json({ error: 'You do not have permission for this action' });
      return;
    }
    next();
  };
}
