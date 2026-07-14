import { sendRconCommand } from '../rcon';
import type { GameServer } from '../types';

/**
 * Per-game RCON queries for the connected player list.
 * Games without an entry (or without RCON configured) simply don't
 * report players — the UI hides those fields.
 */

interface PlayerQuery {
  command: string;
  parse(response: string): string[];
}

const QUERIES: Record<string, PlayerQuery> = {
  palworld: {
    command: 'ShowPlayers',
    // CSV response: "name,playeruid,steamid" header then one line per player
    parse(response) {
      return response
        .trim()
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.split(',')[0].trim())
        .filter(Boolean);
    },
  },
  minecraft: {
    command: 'list',
    // "There are 2 of a max of 20 players online: alice, bob"
    parse(response) {
      const idx = response.indexOf(':');
      if (idx === -1) return [];
      return response
        .slice(idx + 1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    },
  },
};

export function supportsPlayerList(server: GameServer): boolean {
  return !!QUERIES[server.game] && !!(server.rcon_host && server.rcon_port && server.rcon_password);
}

export async function fetchPlayers(server: GameServer): Promise<string[]> {
  const query = QUERIES[server.game];
  if (!query) throw new Error(`No player query for game '${server.game}'`);
  return query.parse(await sendRconCommand(server, query.command));
}
