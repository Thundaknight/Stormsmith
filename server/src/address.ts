import type { GameServer } from './types';

/**
 * The address shown for a server on the dashboard and in its Discord embed.
 * 'auto' uses the detected public IP and game port; 'custom' lets an admin
 * substitute a domain name (e.g. when a real DNS record fronts the server);
 * 'hidden' suppresses the address entirely.
 */
export function resolveDisplayAddress(server: GameServer, publicIp: string): string | null {
  if (server.address_mode === 'hidden') return null;
  if (server.address_mode === 'custom') return server.custom_address.trim() || null;
  if (publicIp && server.game_port) return `${publicIp}:${server.game_port}`;
  return null;
}
