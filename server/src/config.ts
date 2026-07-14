import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

// JWT secret: use env var if set, otherwise generate once and persist alongside the DB
function loadJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretFile = path.join(dataDir, '.jwt-secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

// Migrate data from installs of the pre-rename "server-manager" image
function resolveDbFile(): string {
  const dbFile = path.join(dataDir, 'stormsmith.db');
  const legacy = path.join(dataDir, 'server-manager.db');
  if (!fs.existsSync(dbFile) && fs.existsSync(legacy)) {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(legacy + suffix)) fs.renameSync(legacy + suffix, dbFile + suffix);
    }
  }
  return dbFile;
}

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  dataDir,
  dbFile: resolveDbFile(),
  jwtSecret: loadJwtSecret(),
  tokenTtl: process.env.TOKEN_TTL || '7d',
  // Docker connection: DOCKER_HOST=tcp://ip:2375 for remote, otherwise the local socket
  dockerHost: process.env.DOCKER_HOST || '',
  dockerSocket: process.env.DOCKER_SOCK || '/var/run/docker.sock',
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000', 10),
};
