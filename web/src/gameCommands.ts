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
  /**
   * Standard AzerothCore GM console commands, sent over the worldserver's
   * SOAP interface. Syntax verified against https://www.azerothcore.org/wiki/gm-commands
   * Unlike Palworld, AzerothCore's command parser takes the rest of the line
   * as the final text argument, so no space-escaping is needed.
   */
  azerothcore: [
    {
      command: '.server info',
      label: 'Server Info',
      description: 'Show server version and connected player count (includes bots).',
      params: [],
    },
    {
      command: '.announce',
      label: 'Announce',
      description: 'Send a chat announcement to all online players.',
      params: [{ name: 'message', placeholder: 'Message to announce', required: true }],
    },
    {
      command: '.notify',
      label: 'Notify (screen popup)',
      description: 'Show an on-screen notification to all online players.',
      params: [{ name: 'message', placeholder: 'Message to show', required: true }],
    },
    {
      command: '.saveall',
      label: 'Save All Characters',
      description: 'Force-save every online character.',
      params: [],
    },
    {
      command: '.kick',
      label: 'Kick Player',
      description: 'Remove a player from the world.',
      params: [
        { name: 'name', placeholder: 'Character name', required: true },
        { name: 'reason', placeholder: 'Reason (optional)', required: false },
      ],
    },
    {
      command: '.mute',
      label: 'Mute Player',
      description: 'Disable chat for a player (can be offline).',
      params: [
        { name: 'name', placeholder: 'Character name', required: true },
        { name: 'minutes', placeholder: 'Duration in minutes', required: true },
        { name: 'reason', placeholder: 'Reason (optional)', required: false },
      ],
    },
    {
      command: '.unmute',
      label: 'Unmute Player',
      description: 'Restore chat for a player.',
      params: [{ name: 'name', placeholder: 'Character name', required: true }],
    },
    {
      command: '.ban account',
      label: 'Ban Account',
      description: 'Ban the account owning a character. Use a negative duration for a permanent ban.',
      params: [
        { name: 'name', placeholder: 'Account or character name', required: true },
        { name: 'bantime', placeholder: 'Duration, e.g. 1d, 2w, or -1 for permanent', required: true },
        { name: 'reason', placeholder: 'Reason', required: true },
      ],
      destructive: true,
    },
    {
      command: '.unban account',
      label: 'Unban Account',
      description: 'Remove an account ban.',
      params: [{ name: 'name', placeholder: 'Account name', required: true }],
    },
    {
      command: '.revive',
      label: 'Revive Player',
      description: 'Revive a player.',
      params: [{ name: 'name', placeholder: 'Character name (optional)', required: false }],
    },
    {
      command: '.appear',
      label: 'Teleport to Player',
      description: 'Teleport the GM account to a player (can be offline).',
      params: [{ name: 'name', placeholder: 'Character name', required: true }],
    },
    {
      command: '.summon',
      label: 'Summon Player',
      description: 'Bring a player to the GM account (can be offline).',
      params: [{ name: 'name', placeholder: 'Character name', required: true }],
    },
    {
      command: '.server shutdown',
      label: 'Shutdown Server',
      description: 'Tell the game process to shut down gracefully after a delay. For a full container restart, use the Restart button in Controls instead.',
      params: [{ name: 'seconds', placeholder: 'Delay in seconds', required: true }],
      destructive: true,
    },
    {
      command: '.server restart',
      label: 'Restart Server',
      description: 'Tell the game process to restart after a delay.',
      params: [{ name: 'seconds', placeholder: 'Delay in seconds', required: true }],
      destructive: true,
    },
  ],
  /**
   * ValheimRcon (BepInEx plugin) commands, verified against
   * https://github.com/Tristan-dvr/ValheimRcon/blob/master/commands.md
   * Only available when Stormsmith detects ValheimRcon.dll on the server. IDs are
   * Platform User IDs (Steam_7656…); the parser takes the rest of the line as text.
   */
  valheim: [
    {
      command: 'players',
      label: 'Show Players',
      description: 'List online players with their positions and zones.',
      params: [],
    },
    {
      command: 'serverStats',
      label: 'Server Stats',
      description: 'Player count, FPS, memory and world data.',
      params: [],
    },
    {
      command: 'save',
      label: 'Save World',
      description: 'Save the current world state.',
      params: [],
    },
    {
      command: 'say',
      label: 'Broadcast (chat)',
      description: 'Send a chat message to all players.',
      params: [{ name: 'message', placeholder: 'Message to all players', required: true }],
    },
    {
      command: 'showMessage',
      label: 'Broadcast (screen)',
      description: 'Show a centered on-screen message to all players.',
      params: [{ name: 'message', placeholder: 'Message to show', required: true }],
    },
    {
      command: 'kick',
      label: 'Kick Player',
      description: 'Remove a player from the server.',
      params: [{ name: 'player', placeholder: 'Player name or Steam ID', required: true }],
    },
    {
      command: 'ban',
      label: 'Ban Player',
      description: 'Ban a player by name or Steam ID (also writes bannedlist.txt).',
      params: [{ name: 'player', placeholder: 'Player name or Steam ID', required: true }],
      destructive: true,
    },
    {
      command: 'unban',
      label: 'Unban Player',
      description: 'Remove a ban by name or Steam ID.',
      params: [{ name: 'player', placeholder: 'Player name or Steam ID', required: true }],
    },
    {
      command: 'banlist',
      label: 'Show Bans',
      description: 'List banned players.',
      params: [],
    },
    {
      command: 'adminlist',
      label: 'Show Admins',
      description: 'List server administrators.',
      params: [],
    },
    {
      command: 'disconnectAll',
      label: 'Disconnect Everyone',
      description: 'Kick every connected player at once (they can rejoin).',
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
