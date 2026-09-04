import { sendRconCommand } from '../rcon';
import type { GameServer } from '../types';
import { fetchAzerothPlayers, hasDbConfig } from './azerothcore';

/**
 * Per-game connected-player queries. Most games query over RCON; AzerothCore
 * has no RCON player list that excludes mod-playerbots bots, so it queries
 * the character/auth databases directly instead (see games/azerothcore.ts).
 * Games without an entry (or without the needed connection configured)
 * simply don't report players — the UI hides those fields.
 */

interface RconPlayerQuery {
  command: string;
  parse(response: string): string[];
}

const RCON_QUERIES: Record<string, RconPlayerQuery> = {
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
  valheim: {
    // ValheimRcon's 'players' command — needs the ValheimRcon BepInEx mod on the server.
    command: 'players',
    /**
     * ValheimRcon (Tristan-dvr) replies with a summary line then one line per peer:
     *
     *   Online 2
     *   Alice Steam ID:76561198... Position: (x, y, z) Zone: (i, j) Player ID:1 HP:25/25 ...
     *   Bob Steam ID:76561198... Position: ...
     *
     * The player name is everything before " Steam ID:" (names may contain spaces).
     * The "Online N" line is a count header, not a player — dropping it is what keeps
     * an empty server ("Online 0") from showing a phantom player.
     */
    parse(response) {
      return response
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^online\s+\d+$/i.test(line) && !/^no players/i.test(line))
        .map((line) => {
          const m = line.match(/^(.+?)\s+Steam ID:/i);
          return (m ? m[1] : line.split(/\s{2,}|\t/)[0]).trim();
        })
        .filter(Boolean);
    },
  },
};

export function supportsPlayerList(server: GameServer): boolean {
  if (server.game === 'azerothcore') return hasDbConfig(server);
  return !!RCON_QUERIES[server.game] && !!(server.rcon_host && server.rcon_port && server.rcon_password);
}

export async function fetchPlayers(server: GameServer): Promise<string[]> {
  if (server.game === 'azerothcore') return fetchAzerothPlayers(server);
  const query = RCON_QUERIES[server.game];
  if (!query) throw new Error(`No player query for game '${server.game}'`);
  return query.parse(await sendRconCommand(server, query.command));
}
