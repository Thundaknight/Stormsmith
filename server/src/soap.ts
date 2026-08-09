import type { GameServer } from './types';

/**
 * AzerothCore's worldserver SOAP interface (SOAP.Enabled=1 in worldserver.conf,
 * default port 7878). A single `executeCommand` operation runs any GM console
 * command; the account used must be a GM (level 3+) with account_access
 * realmID = -1. Auth is plain HTTP Basic over the SOAP endpoint.
 * https://www.azerothcore.org/wiki/remote-access
 */

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export async function sendSoapCommand(server: GameServer, command: string): Promise<string> {
  if (!server.rcon_host || !server.rcon_port || !server.rcon_username || !server.rcon_password) {
    throw new Error('SOAP connection is not configured for this server (host, port, username, password)');
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/1999/XMLSchema-instance" xmlns:xsd="http://www.w3.org/1999/XMLSchema" xmlns:ns1="urn:AC">
<SOAP-ENV:Body>
<ns1:executeCommand><command>${escapeXml(command)}</command></ns1:executeCommand>
</SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  const auth = Buffer.from(`${server.rcon_username}:${server.rcon_password}`).toString('base64');
  const url = `http://${server.rcon_host}:${server.rcon_port}/`;

  let text: string;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml', Authorization: `Basic ${auth}` },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    text = await res.text();
    if (!res.ok && !text.includes('faultstring')) {
      throw new Error(`SOAP request failed (HTTP ${res.status})`);
    }
  } catch (err: any) {
    if (err?.name === 'TimeoutError') throw new Error('SOAP request timed out');
    throw new Error(`SOAP connection failed: ${err?.message || err}`);
  }

  const fault = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(text);
  if (fault) throw new Error(decodeXml(fault[1]).trim());

  const result = /<result>([\s\S]*?)<\/result>/.exec(text);
  return result ? decodeXml(result[1]).trim() : '';
}
