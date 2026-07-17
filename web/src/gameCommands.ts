export interface CommandParam {
  name: string;
  placeholder: string;
  required: boolean;
  /**
   * Palworld drops everything after the first space in text arguments.
   * Spaces are sent as non-breaking spaces (raw 0xA0 over RCON), which
   * Palworld renders as normal spaces in-game.
   */
  escapeSpaces?: boolean;
}

export interface GameCommand {
  command: string;
  label: string;
  description: string;
  params: CommandParam[];
  /** Extra caution: show a confirm dialog before sending. */
  destructive?: boolean;
}

/**
 * Per-game RCON command palettes shown on the server detail page.
 * Palworld list from https://docs.palworldgame.com/settings-and-operation/commands
 * (AdminPassword is not needed over RCON, and the teleport/spectate commands
 * only work from an in-game character, so they are omitted.)
 */
export const GAME_COMMANDS: Record<string, GameCommand[]> = {
  palworld: [
    {
      command: 'ShowPlayers',
      label: 'Show Players',
      description: 'Show information on all connected players.',
      params: [],
    },
    {
      command: 'Info',
      label: 'Server Info',
      description: 'Show server information.',
      params: [],
    },
    {
      command: 'Save',
      label: 'Save World',
      description: 'Save the world data.',
      params: [],
    },
    {
      command: 'Broadcast',
      label: 'Broadcast',
      description: 'Send a message to all players on the server.',
      params: [
        { name: 'MessageText', placeholder: 'Message to all players', required: true, escapeSpaces: true },
      ],
    },
    {
      command: 'KickPlayer',
      label: 'Kick Player',
      description: 'Kick a player from the server.',
      params: [{ name: 'SteamID', placeholder: 'Player Steam ID (from Show Players)', required: true }],
    },
    {
      command: 'BanPlayer',
      label: 'Ban Player',
      description: 'Ban a player from the server.',
      params: [{ name: 'SteamID', placeholder: 'Player Steam ID (from Show Players)', required: true }],
      destructive: true,
    },
    {
      command: 'UnBanPlayer',
      label: 'Unban Player',
      description: 'Unban a player from the server.',
      params: [{ name: 'SteamID', placeholder: 'Player Steam ID', required: true }],
    },
    {
      command: 'Shutdown',
      label: 'Shutdown (graceful)',
      description: 'Shut the server down after a delay, announcing a message to players. The world is saved.',
      params: [
        { name: 'Seconds', placeholder: 'Delay in seconds (e.g. 60)', required: true },
        { name: 'MessageText', placeholder: 'Announcement (e.g. Server restarting in 60s)', required: false, escapeSpaces: true },
      ],
      destructive: true,
    },
    {
      command: 'DoExit',
      label: 'Force Stop',
      description: 'Force-stop the server immediately without saving. Prefer Shutdown.',
      params: [],
      destructive: true,
    },
  ],
};

export function buildCommand(cmd: GameCommand, values: Record<string, string>): string {
  const parts = [cmd.command];
  for (const p of cmd.params) {
    let v = (values[p.name] || '').trim();
    if (!v) continue;
    if (p.escapeSpaces) v = v.replace(/ /g, '\u00A0');
    parts.push(v);
  }
  return parts.join(' ');
}
