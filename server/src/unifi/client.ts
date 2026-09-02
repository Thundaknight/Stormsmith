import https from 'https';
import type { UnifiConfig } from '../types';

/**
 * Minimal UniFi OS (UDM / UDM-Pro / UDR / UCG / Cloud Key Gen2+) client, covering
 * just what port-forward automation needs.
 *
 * Port forwards are only exposed by the "classic" Network API, not by the newer
 * official X-API-KEY integration API, so this authenticates the way the web UI
 * does: POST /api/auth/login with a *local* admin account, then replay the TOKEN
 * cookie plus the x-csrf-token header against /proxy/network/api/s/<site>/...
 *
 * Written on node:https rather than global fetch because UniFi consoles ship
 * self-signed certificates and fetch can only relax TLS through an undici
 * dispatcher, which isn't a dependency here. node:https is core and also gives
 * direct control over the cookie jar.
 */

const TIMEOUT_MS = 10_000;
/** After this many consecutive login failures, stop retrying more than once a minute. */
const AUTH_FAILURE_LIMIT = 3;
const AUTH_BACKOFF_MS = 60_000;

export interface PortForwardRule {
  _id: string;
  name: string;
  enabled: boolean;
  dst_port?: string;
  fwd?: string;
  fwd_port?: string;
  proto?: string;
  /** Every other field UniFi stores on the rule; preserved verbatim when writing back. */
  [key: string]: unknown;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: any;
}

export class UnifiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export class UnifiClient {
  private cookies = new Map<string, string>();
  private csrfToken = '';
  private authFailures = 0;
  private lastAuthAttempt = 0;

  constructor(private cfg: Pick<UnifiConfig, 'host' | 'port' | 'site' | 'username' | 'password' | 'verify_tls'>) {}

  isAuthenticated(): boolean {
    return this.cookies.size > 0;
  }

  /** Drops the session so the next call re-authenticates. */
  reset(): void {
    this.cookies.clear();
    this.csrfToken = '';
  }

  private get basePath(): string {
    return `/proxy/network/api/s/${encodeURIComponent(this.cfg.site || 'default')}`;
  }

  private request(method: string, path: string, body?: unknown): Promise<RawResponse> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const origin = `https://${this.cfg.host}${this.cfg.port && this.cfg.port !== 443 ? `:${this.cfg.port}` : ''}`;
    // UniFi OS's CSRF protection inspects Origin/Referer as well as the token header, so
    // present the same shape a browser on the console's own login page would.
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Origin: origin,
      Referer: `${origin}/login`,
    };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    // UniFi OS rejects state-changing calls without the CSRF token it handed out at login.
    if (this.csrfToken && method !== 'GET') headers['X-CSRF-Token'] = this.csrfToken;

    return new Promise<RawResponse>((resolve, reject) => {
      const req = https.request(
        {
          host: this.cfg.host,
          port: this.cfg.port || 443,
          path,
          method,
          headers,
          rejectUnauthorized: !!this.cfg.verify_tls,
          timeout: TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json: any = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              /* non-JSON bodies (HTML error pages) are reported by status alone */
            }
            this.captureSession(res.headers);
            resolve({ status: res.statusCode || 0, headers: res.headers, text, json });
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('timed out')));
      req.on('error', (err: any) => reject(describeTransportError(err, this.cfg)));
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  /** Stores the TOKEN cookie and CSRF token; UniFi rotates both, so this runs on every response. */
  private captureSession(headers: Record<string, string | string[] | undefined>): void {
    const setCookie = headers['set-cookie'];
    if (Array.isArray(setCookie)) {
      for (const raw of setCookie) {
        const [pair] = raw.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
    const csrf = headers['x-csrf-token'] ?? headers['x-updated-csrf-token'];
    if (typeof csrf === 'string' && csrf) {
      this.csrfToken = csrf;
      return;
    }
    // UniFi OS doesn't reliably send the header. The token is also carried as a claim
    // inside the TOKEN cookie's JWT payload, which is where the web UI reads it from.
    const fromCookie = this.csrfFromTokenCookie();
    if (fromCookie) this.csrfToken = fromCookie;
  }

  /** Pulls the `csrfToken` claim out of the TOKEN cookie's JWT payload. */
  private csrfFromTokenCookie(): string {
    const token = this.cookies.get('TOKEN');
    if (!token) return '';
    const parts = token.split('.');
    if (parts.length < 2) return '';
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return typeof payload?.csrfToken === 'string' ? payload.csrfToken : '';
    } catch {
      return '';
    }
  }

  /**
   * UniFi OS's nginx front end rejects any POST without an X-CSRF-Token — including the
   * login itself, with a bare 403 and no explanation. The token is only handed out in a
   * response, so the session has to be primed with a GET first (this is what the browser
   * does when it loads the login page). The body is discarded; we only want the headers.
   *
   * Older/standalone controllers don't require this, so a failure here is not fatal —
   * the login is attempted regardless.
   */
  private async primeCsrf(): Promise<void> {
    try {
      const res = await this.request('GET', '/');
      // Consoles vary in how they hand out the token, so say what we actually got —
      // without this a 403 later gives no clue which half of the handshake failed.
      console.log(
        `[unifi] prime GET / -> HTTP ${res.status}; cookies=[${[...this.cookies.keys()].join(',') || 'none'}]; ` +
        `csrf=${this.csrfToken ? 'acquired' : 'NONE'}`
      );
    } catch (err: any) {
      console.log(`[unifi] prime GET / failed: ${err?.message || err}`);
    }
  }

  async login(): Promise<void> {
    if (!this.cfg.host || !this.cfg.username || !this.cfg.password) {
      throw new UnifiError('UniFi connection is not configured (host, username, password)');
    }
    // Bad credentials in a 60s reconcile loop would otherwise hammer the console into a lockout.
    if (this.authFailures >= AUTH_FAILURE_LIMIT && Date.now() - this.lastAuthAttempt < AUTH_BACKOFF_MS) {
      throw new UnifiError('Login is backing off after repeated failures — check the username and password');
    }
    this.lastAuthAttempt = Date.now();
    this.reset();
    await this.primeCsrf();

    const res = await this.request('POST', '/api/auth/login', {
      username: this.cfg.username,
      password: this.cfg.password,
      remember: true,
    });

    console.log(
      `[unifi] login POST -> HTTP ${res.status}; sent csrf=${this.csrfToken ? 'yes' : 'no'}; ` +
      `cookies=[${[...this.cookies.keys()].join(',') || 'none'}]`
    );
    if (res.status === 200 && this.cookies.size > 0) {
      this.authFailures = 0;
      return;
    }
    this.authFailures++;
    this.reset();
    throw new UnifiError(loginErrorMessage(res), res.status);
  }

  /** Runs a call, logging in first if needed and once more if the session turned out to be stale. */
  private async authed(method: string, path: string, body?: unknown): Promise<RawResponse> {
    if (!this.isAuthenticated()) await this.login();
    let res = await this.request(method, path, body);
    if (isAuthFailure(res)) {
      await this.login();
      res = await this.request(method, path, body);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new UnifiError(apiErrorMessage(res), res.status);
    }
    return res;
  }

  async listPortForwards(): Promise<PortForwardRule[]> {
    const res = await this.authed('GET', `${this.basePath}/rest/portforward`);
    const data = res.json?.data;
    if (!Array.isArray(data)) throw new UnifiError('Unexpected response listing port forwards');
    return data.filter((r: any) => r && typeof r._id === 'string').map((r: any) => ({
      ...r,
      name: String(r.name ?? ''),
      enabled: !!r.enabled,
    })) as PortForwardRule[];
  }

  /**
   * Flips a rule's `enabled` flag. UniFi's REST PUT *replaces* the object, so the rule is
   * re-read and sent back whole — a partial body would silently drop its other fields.
   */
  async setPortForwardEnabled(ruleId: string, enabled: boolean): Promise<void> {
    const path = `${this.basePath}/rest/portforward/${encodeURIComponent(ruleId)}`;
    const gone = new UnifiError(`Port-forward rule ${ruleId} no longer exists on the controller`, 404);
    let res;
    try {
      res = await this.authed('GET', path);
    } catch (err) {
      // A deleted rule 404s; say so plainly rather than surfacing a bare status.
      if (err instanceof UnifiError && err.status === 404) throw gone;
      throw err;
    }
    const rule = Array.isArray(res.json?.data) ? res.json.data[0] : null;
    // Some firmware answers 200 with an empty data array instead of 404.
    if (!rule || typeof rule._id !== 'string') throw gone;
    if (!!rule.enabled === enabled) return;
    await this.authed('PUT', path, { ...rule, enabled });
  }
}

function isAuthFailure(res: RawResponse): boolean {
  if (res.status === 401 || res.status === 403) return true;
  return res.json?.meta?.rc === 'error' && String(res.json?.meta?.msg || '').includes('LoginRequired');
}

/** UniFi's two most common setup mistakes deserve a real explanation, not the raw status. */
function loginErrorMessage(res: RawResponse): string {
  const msg = String(res.json?.meta?.msg || '');
  if (res.status === 499 || msg.includes('2fa') || msg.includes('Ubic2faTokenRequired')) {
    return 'This UniFi account has two-factor authentication enabled, which the port-forward API cannot use. ' +
      'Create a dedicated local admin account without 2FA.';
  }
  if (res.status === 401 || res.status === 400) {
    return 'UniFi rejected the login. Use a local UniFi admin account — cloud/Ubiquiti SSO logins cannot ' +
      'use this API.';
  }
  if (res.status === 403) {
    // 403 (rather than 401) means the request was refused before the credentials were even
    // examined — nearly always the CSRF handshake, occasionally a temporary IP block.
    return 'UniFi refused the login request (HTTP 403). This usually means the console rejected the ' +
      'CSRF handshake — check that the host and port point at the UniFi console itself and not a ' +
      'reverse proxy. Repeated failed logins can also block the caller for a few minutes.';
  }
  if (res.status === 429) return 'UniFi is rate-limiting logins — wait a minute and try again.';
  return `UniFi login failed (HTTP ${res.status})`;
}

function apiErrorMessage(res: RawResponse): string {
  const msg = String(res.json?.meta?.msg || '').trim();
  if (msg) return `UniFi API error: ${msg}`;
  return `UniFi API request failed (HTTP ${res.status})`;
}

function describeTransportError(err: any, cfg: { host: string; port: number; verify_tls: number }): Error {
  const code = err?.code || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new UnifiError(`Cannot resolve UniFi host '${cfg.host}'`);
  }
  if (code === 'ECONNREFUSED') {
    return new UnifiError(`UniFi refused the connection on ${cfg.host}:${cfg.port || 443}`);
  }
  if (code === 'ETIMEDOUT' || /timed out/i.test(err?.message || '')) {
    return new UnifiError(`UniFi at ${cfg.host}:${cfg.port || 443} did not respond`);
  }
  if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN' || code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return new UnifiError(
      'UniFi is using a self-signed certificate. Turn off "Verify TLS certificate" for a local console.'
    );
  }
  return new UnifiError(`UniFi connection failed: ${err?.message || err}`);
}
