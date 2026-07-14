import { Rcon } from 'rcon-client';
import type { GameServer } from './types';

/**
 * Sends a single RCON command using the Source RCON protocol
 * (used by Palworld, Minecraft, Rust, ARK, Valheim+BepInEx, etc.).
 * Connects per command to avoid stale connections to servers that restart often.
 */
export async function sendRconCommand(server: GameServer, command: string): Promise<string> {
  if (!server.rcon_host || !server.rcon_port || !server.rcon_password) {
    throw new Error('RCON is not configured for this server');
  }
  const rcon = await Rcon.connect({
    host: server.rcon_host,
    port: server.rcon_port,
    password: server.rcon_password,
    timeout: 5000,
  });
  try {
    const response = await rcon.send(command);
    return response ?? '';
  } finally {
    rcon.end().catch(() => {});
  }
}

/** Sends an in-game broadcast using the server's game-specific template. */
export async function sendBroadcast(server: GameServer, message: string): Promise<string> {
  if (!server.broadcast_template) throw new Error('No broadcast template configured for this server');
  // Palworld's Broadcast command doesn't handle spaces well on some builds; callers can
  // set a template like "Broadcast {message_underscored}" if needed.
  const command = server.broadcast_template
    .replace('{message}', message)
    .replace('{message_underscored}', message.replace(/ /g, '_'));
  return sendRconCommand(server, command);
}
