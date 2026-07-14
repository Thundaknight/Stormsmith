/**
 * The public IP shown on the dashboard and in Discord embeds.
 * Set PUBLIC_IP to override (e.g. a domain name); otherwise it is
 * discovered via api.ipify.org and refreshed every 6 hours.
 */

const REFRESH_MS = 6 * 60 * 60 * 1000;

let cached = process.env.PUBLIC_IP || '';

export function getPublicIp(): string {
  return cached;
}

async function refresh(): Promise<void> {
  if (process.env.PUBLIC_IP) return;
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(10_000) });
    const text = (await res.text()).trim();
    if (res.ok && /^[0-9a-fA-F.:]+$/.test(text)) cached = text;
  } catch {
    /* keep the previous value; retried on the next cycle */
  }
}

export function initPublicIp(): void {
  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), REFRESH_MS).unref();
}
