import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType,
  ChatInputCommandInteraction, Client, EmbedBuilder, GatewayIntentBits, GuildMember,
  Interaction, ModalBuilder, ModalSubmitInteraction, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, TextChannel, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { resolveDisplayAddress } from '../address';
import {
  deleteStatusMessage, getDiscordConfig, getServerById, getStatusMessage,
  listCustomFields, listDiscordRolePerms, listServers, listStatusMessages, setStatusMessage,
} from '../db';
import { performAction } from '../docker';
import { monitor } from '../monitor';
import { getPublicIp } from '../publicIp';
import { sendBroadcast, sendRconCommand } from '../rcon';
import { delayScheduledRestart, getNextScheduledRestart } from '../scheduler';
import type { ContainerState, DiscordConfig, DiscordRolePerm, GameServer, ServerAction, ServerStatus } from '../types';

type DiscordPerm = 'commands' | 'start' | 'stop' | 'restart' | 'rcon' | 'broadcast' | 'wowCreate';

const PERM_COLUMN: Record<DiscordPerm, keyof DiscordRolePerm> = {
  commands: 'can_use_commands',
  start: 'can_start',
  stop: 'can_stop',
  restart: 'can_restart',
  rcon: 'can_rcon',
  broadcast: 'can_broadcast',
  wowCreate: 'can_create_wow_accounts',
};

/** Strips a Discord display name down to a safe AzerothCore account name. */
function sanitizeWowUsername(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  return cleaned || 'player';
}

const STATE_EMOJI: Record<ContainerState, string> = {
  running: '🟢', paused: '🟡', restarting: '🔄', exited: '🔴',
  created: '⚪', dead: '💀', removing: '🗑️', not_found: '❓',
};

const GAME_LABELS: Record<string, string> = {
  palworld: 'Palworld',
  minecraft: 'Minecraft',
  satisfactory: 'Satisfactory',
  valheim: 'Valheim',
  rust: 'Rust',
  ark: 'ARK: Survival',
  '7dtd': '7 Days to Die',
  azerothcore: 'AzerothCore (WoW)',
  custom: 'Custom',
};

const MAX_EMBED_PLAYERS = 10;

function formatUptime(startedAt: string | null): string {
  if (!startedAt) return '—';
  const ms = Date.now() - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000) % 24;
  const minutes = Math.floor(ms / 60_000) % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function parseIds(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

class DiscordBot {
  private client: Client | null = null;
  private cfg: DiscordConfig | null = null;
  private updateTimer: NodeJS.Timeout | null = null;
  private updateQueued = false;
  public lastError = '';

  constructor() {
    // Keep the status embed fresh when container states change
    monitor.on('change', () => this.queueStatusUpdate());
  }

  isRunning(): boolean {
    return !!this.client?.isReady();
  }

  async start(): Promise<void> {
    const cfg = getDiscordConfig();
    this.cfg = cfg;
    this.lastError = '';
    if (!cfg.enabled || !cfg.bot_token) return;

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    this.client = client;

    client.on('interactionCreate', (interaction) => {
      this.handleInteraction(interaction).catch((err) => {
        console.error('[discord] interaction error:', err);
      });
    });

    try {
      await client.login(cfg.bot_token);
      await this.registerCommands();
    } catch (err: any) {
      this.lastError = err?.message || String(err);
      console.error('[discord] failed to start bot:', this.lastError);
      await this.stop();
      return;
    }

    // Periodic refresh so uptime text stays roughly current even without state changes
    this.updateTimer = setInterval(() => this.queueStatusUpdate(), 60_000);
    this.queueStatusUpdate();
    console.log(`[discord] bot logged in as ${client.user?.tag}`);
  }

  async stop(): Promise<void> {
    if (this.updateTimer) clearInterval(this.updateTimer);
    this.updateTimer = null;
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Whether the given Discord user is a member of the configured guild (used to gate web-login sign-ups). */
  async isGuildMember(discordUserId: string): Promise<boolean> {
    const cfg = this.cfg;
    if (!this.client?.isReady() || !cfg?.guild_id) return false;
    try {
      const guild = await this.client.guilds.fetch(cfg.guild_id);
      await guild.members.fetch(discordUserId);
      return true;
    } catch {
      return false;
    }
  }

  /** Guild roles and text channels, for populating pickers in the web UI. */
  async getGuildMeta(): Promise<{ roles: Array<{ id: string; name: string }>; channels: Array<{ id: string; name: string }> }> {
    const cfg = this.cfg;
    if (!this.client?.isReady() || !cfg?.guild_id) return { roles: [], channels: [] };
    const guild = await this.client.guilds.fetch(cfg.guild_id);
    const roles = await guild.roles.fetch();
    const channels = await guild.channels.fetch();
    return {
      roles: roles
        .filter((r) => r.name !== '@everyone')
        .map((r) => ({ id: r.id, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      channels: [...channels.values()]
        .filter((c): c is NonNullable<typeof c> => !!c && c.type === ChannelType.GuildText)
        .map((c) => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  private async registerCommands(): Promise<void> {
    const cfg = this.cfg!;
    if (!cfg.guild_id || !this.client?.user) return;

    const serverOption = (o: any) =>
      o.setName('server').setDescription('Server name').setRequired(true).setAutocomplete(true);

    const commands = [
      new SlashCommandBuilder().setName('servers').setDescription('Show the status of all game servers'),
      new SlashCommandBuilder()
        .setName('server')
        .setDescription('Control a game server')
        .addStringOption((o) =>
          o.setName('action').setDescription('Action to perform').setRequired(true).addChoices(
            { name: 'start', value: 'start' },
            { name: 'stop', value: 'stop' },
            { name: 'restart', value: 'restart' },
            { name: 'pause', value: 'pause' },
            { name: 'unpause', value: 'unpause' },
          )
        )
        .addStringOption(serverOption),
      new SlashCommandBuilder()
        .setName('rcon')
        .setDescription('Send an RCON command to a game server')
        .addStringOption(serverOption)
        .addStringOption((o) => o.setName('command').setDescription('RCON command').setRequired(true)),
      new SlashCommandBuilder()
        .setName('broadcast')
        .setDescription('Send an in-game message to a server')
        .addStringOption(serverOption)
        .addStringOption((o) => o.setName('message').setDescription('Message to send').setRequired(true)),
      new SlashCommandBuilder()
        .setName('wowcreate')
        .setDescription('DM a Discord user to set up an AzerothCore WoW account')
        .addUserOption((o) => o.setName('user').setDescription('Discord user to create the account for').setRequired(true))
        .addStringOption(serverOption)
        .addStringOption((o) =>
          o.setName('username').setDescription('WoW account username (default: their Discord name)').setRequired(false)
        ),
    ].map((c) => c.toJSON());

    const rest = new REST().setToken(cfg.bot_token);
    await rest.put(Routes.applicationGuildCommands(this.client.user.id, cfg.guild_id), { body: commands });
  }

  // ---- Status embed ----

  private queueStatusUpdate(): void {
    if (this.updateQueued) return;
    this.updateQueued = true;
    // Debounce bursts of state changes into one edit
    setTimeout(() => {
      this.updateQueued = false;
      this.updateStatusMessage().catch((err) => console.error('[discord] status update failed:', err));
    }, 1500);
  }

  private static readonly STATE_COLOR: Record<ContainerState, number> = {
    running: 0x3ba55d, paused: 0xfaa61a, restarting: 0xfaa61a, exited: 0xed4245,
    created: 0x99aab5, dead: 0xed4245, removing: 0x99aab5, not_found: 0x99aab5,
  };

  /** Builds a single server's status embed. */
  private buildServerEmbed(s: ServerStatus): EmbedBuilder {
    const server = getServerById(s.serverId);
    const lines = [
      `**Game:** ${GAME_LABELS[s.game] || s.game}`,
      `**Uptime:** ${s.state === 'running' ? formatUptime(s.startedAt) : '—'}`,
    ];
    const nextRestart = getNextScheduledRestart(s.serverId);
    if (nextRestart) lines.push(`**Next restart:** <t:${Math.floor(nextRestart / 1000)}:R>`);
    const address = server ? resolveDisplayAddress(server, getPublicIp()) : null;
    if (address) lines.push(`**Server IP:** \`${address}\``);
    lines.push(`**Players:** ${s.playerCount != null ? s.playerCount : '—'}`);
    if (s.players && s.players.length > 0) {
      const shown = s.players.slice(0, MAX_EMBED_PLAYERS).join(', ');
      const extra = s.players.length > MAX_EMBED_PLAYERS ? ` +${s.players.length - MAX_EMBED_PLAYERS} more` : '';
      lines.push(shown + extra);
    }
    if (server) {
      for (const field of listCustomFields(server.id)) {
        if (field.type === 'link') lines.push(`[${field.title || field.content}](${field.content})`);
        else lines.push(field.content);
      }
    }
    return new EmbedBuilder()
      .setTitle(`${STATE_EMOJI[s.state] || '❓'} ${s.name}`)
      .setColor(DiscordBot.STATE_COLOR[s.state] ?? 0x99aab5)
      .setDescription(lines.join('\n').slice(0, 4096))
      .setTimestamp(new Date());
  }

  /** One embed per server (e.g. for the ephemeral /servers reply); Discord allows at most 10 per message. */
  private buildStatusEmbeds(statuses: ServerStatus[]): EmbedBuilder[] {
    if (statuses.length === 0) {
      return [
        new EmbedBuilder()
          .setTitle('🎮 Game Server Status')
          .setColor(0x99aab5)
          .setDescription('No servers have been imported yet.'),
      ];
    }
    return statuses.slice(0, 10).map((s) => this.buildServerEmbed(s));
  }

  /** Builds a single server's control-button row, or null if no buttons apply. */
  private buildServerButtons(s: ServerStatus): ActionRowBuilder<ButtonBuilder> | null {
    const cfg = this.cfg!;
    const row = new ActionRowBuilder<ButtonBuilder>();
    const running = s.state === 'running' || s.state === 'paused' || s.state === 'restarting';
    if (cfg.allow_start) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`srv:start:${s.serverId}`).setLabel(`▶ ${s.name}`)
          .setStyle(ButtonStyle.Success).setDisabled(running)
      );
    }
    if (cfg.allow_stop) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`srv:stop:${s.serverId}`).setLabel(`⏹ ${s.name}`)
          .setStyle(ButtonStyle.Danger).setDisabled(!running)
      );
    }
    if (cfg.allow_restart) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`srv:restart:${s.serverId}`).setLabel(`🔄 ${s.name}`)
          .setStyle(ButtonStyle.Secondary).setDisabled(!running)
      );
    }
    if (cfg.allow_restart && getNextScheduledRestart(s.serverId) !== null) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`srv:delay:${s.serverId}`).setLabel(`⏰ ${s.name}`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    return row.components.length > 0 ? row : null;
  }

  /**
   * Maintains one message per server — its own embed immediately followed by
   * its own button row — instead of bundling every server into one shared
   * message. Each server chooses its channel (discord_channel_id, falling
   * back to the default status channel) and can opt out of Discord display
   * entirely (discord_show = 0). Messages are sent in a stable order (by
   * server id) so they stack top-to-bottom predictably the first time
   * they're created; Discord has no way to reorder existing messages.
   */
  private async updateStatusMessage(): Promise<void> {
    const cfg = this.cfg;
    if (!this.client?.isReady() || !cfg) return;

    const statusById = new Map(monitor.getAll().map((s) => [s.serverId, s]));
    interface Target { server: GameServer; channelId: string; status: ServerStatus }
    const targets = (
      listServers()
        .filter((server) => server.discord_show)
        .map((server) => ({
          server,
          channelId: server.discord_channel_id || cfg.status_channel_id,
          status: statusById.get(server.id),
        }))
        .filter((t) => !!t.channelId && !!t.status) as Target[]
    ).sort((a, b) => a.server.id - b.server.id);

    const activeServerIds = new Set(targets.map((t) => t.server.id));

    for (const { server, channelId, status } of targets) {
      const channel = await this.client.channels.fetch(channelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel)) continue;

      const buttons = this.buildServerButtons(status);
      const payload = { embeds: [this.buildServerEmbed(status)], components: buttons ? [buttons] : [] };

      const existing = getStatusMessage(server.id);
      if (existing && existing.channel_id === channelId) {
        const msg = await channel.messages.fetch(existing.message_id).catch(() => null);
        if (msg) {
          await msg.edit(payload).catch(() => {});
          continue;
        }
      } else if (existing) {
        // The server's target channel changed — drop the old message from its old channel
        const oldChannel = await this.client.channels.fetch(existing.channel_id).catch(() => null);
        if (oldChannel instanceof TextChannel) {
          const oldMsg = await oldChannel.messages.fetch(existing.message_id).catch(() => null);
          await oldMsg?.delete().catch(() => {});
        }
      }
      const msg = await channel.send(payload).catch(() => null);
      if (msg) setStatusMessage(server.id, channelId, msg.id);
    }

    // Clean up messages for servers that no longer show, or no longer exist
    for (const row of listStatusMessages()) {
      if (activeServerIds.has(row.server_id)) continue;
      const channel = await this.client.channels.fetch(row.channel_id).catch(() => null);
      if (channel instanceof TextChannel) {
        const msg = await channel.messages.fetch(row.message_id).catch(() => null);
        await msg?.delete().catch(() => {});
      }
      deleteStatusMessage(row.server_id);
    }
  }

  // ---- Permission checks ----

  /** Per-role permission check. Discord administrators can always do everything. */
  private memberCan(member: GuildMember, perm: DiscordPerm): boolean {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const column = PERM_COLUMN[perm];
    return listDiscordRolePerms().some((r) => member.roles.cache.has(r.role_id) && !!r[column]);
  }

  /** Public hook so API routes can refresh embeds after settings change. */
  refreshStatus(): void {
    this.queueStatusUpdate();
  }

  private channelAllowed(channelId: string): boolean {
    const allowed = parseIds(this.cfg!.command_channel_ids);
    return allowed.length === 0 || allowed.includes(channelId);
  }

  private actionAllowed(action: ServerAction): boolean {
    const cfg = this.cfg!;
    if (action === 'start') return !!cfg.allow_start;
    if (action === 'stop') return !!cfg.allow_stop;
    // pause/unpause ride along with restart permission
    return !!cfg.allow_restart;
  }

  private rconCommandAllowed(command: string): boolean {
    const allowlist = parseIds(this.cfg!.rcon_command_allowlist);
    if (allowlist.length === 0) return true;
    const lower = command.toLowerCase();
    return allowlist.some((prefix) => lower.startsWith(prefix.toLowerCase()));
  }

  // ---- Interactions ----

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused().toLowerCase();
      const azerothOnly = interaction.commandName === 'wowcreate';
      const servers = listServers()
        .filter((s) => s.name.toLowerCase().includes(focused))
        .filter((s) => !azerothOnly || s.game === 'azerothcore')
        .slice(0, 25)
        .map((s) => ({ name: s.name, value: String(s.id) }));
      await interaction.respond(servers);
      return;
    }
    if (interaction.isButton()) {
      await this.handleButton(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      await this.handleModalSubmit(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      await this.handleCommand(interaction);
    }
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    const [prefix, ...rest] = interaction.customId.split(':');
    if (prefix === 'wowcreate') {
      await this.handleWowCreateButton(interaction, rest);
      return;
    }
    const [action, idStr] = rest;
    if (prefix !== 'srv') return;
    const member = interaction.member as GuildMember | null;

    if (action === 'delay') {
      if (!member || !this.memberCan(member, 'restart')) {
        await interaction.reply({ content: '⛔ You do not have permission to delay restarts.', ephemeral: true });
        return;
      }
      const server = getServerById(parseInt(idStr, 10));
      if (!server) {
        await interaction.reply({ content: 'Server not found.', ephemeral: true });
        return;
      }
      const targetAt = delayScheduledRestart(server.id);
      if (!targetAt) {
        await interaction.reply({ content: `⛔ **${server.name}** has no scheduled restart to delay.`, ephemeral: true });
        return;
      }
      this.queueStatusUpdate();
      await interaction.reply({
        content: `⏰ **${server.name}**: restart delayed to <t:${Math.floor(targetAt / 1000)}:t>.`,
        ephemeral: true,
      });
      return;
    }

    const serverAction = action as ServerAction;
    const permNeeded: DiscordPerm =
      serverAction === 'pause' || serverAction === 'unpause' ? 'restart' : (serverAction as DiscordPerm);
    if (!member || !this.memberCan(member, permNeeded)) {
      await interaction.reply({ content: `⛔ You do not have permission to ${serverAction} servers.`, ephemeral: true });
      return;
    }
    if (!this.actionAllowed(serverAction)) {
      await interaction.reply({ content: '⛔ That action is disabled.', ephemeral: true });
      return;
    }
    const server = getServerById(parseInt(idStr, 10));
    if (!server) {
      await interaction.reply({ content: 'Server not found.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      await performAction(server.container_name, serverAction);
      await monitor.refresh();
      this.queueStatusUpdate();
      await interaction.editReply(`✅ **${server.name}**: ${serverAction} issued.`);
    } catch (err: any) {
      await interaction.editReply(`❌ Failed to ${serverAction} **${server.name}**: ${err?.message || err}`);
    }
  }

  /** "Set Password" button on the /wowcreate DM — only the invited user may click it. */
  private async handleWowCreateButton(interaction: ButtonInteraction, parts: string[]): Promise<void> {
    const [serverIdStr, targetUserId, requesterUserId, username] = parts;
    if (interaction.user.id !== targetUserId) {
      await interaction.reply({ content: '⛔ This button is not for you.', ephemeral: true });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`wowcreatepw:${serverIdStr}:${targetUserId}:${requesterUserId}:${username}`)
      .setTitle('Set your WoW account password')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('password')
            .setLabel('Password')
            .setStyle(TextInputStyle.Short)
            .setMinLength(6)
            .setMaxLength(32)
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('confirm')
            .setLabel('Confirm password')
            .setStyle(TextInputStyle.Short)
            .setMinLength(6)
            .setMaxLength(32)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
  }

  /** Password modal submitted from the /wowcreate DM — creates the AzerothCore account over SOAP. */
  private async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const [prefix, serverIdStr, targetUserId, requesterUserId, username] = interaction.customId.split(':');
    if (prefix !== 'wowcreatepw') return;
    if (interaction.user.id !== targetUserId) {
      await interaction.reply({ content: '⛔ This form is not for you.', ephemeral: true });
      return;
    }
    const password = interaction.fields.getTextInputValue('password');
    const confirm = interaction.fields.getTextInputValue('confirm');
    if (password !== confirm) {
      await interaction.reply({ content: '⛔ Passwords did not match — ask for a new setup link and try again.', ephemeral: true });
      return;
    }
    const server = getServerById(parseInt(serverIdStr, 10));
    if (!server || server.game !== 'azerothcore') {
      await interaction.reply({ content: '⛔ That server is no longer available.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const response = await sendRconCommand(server, `.account create ${username} ${password}`);
      const text = response.trim() || '(no response)';
      await interaction.editReply(`✅ **${server.name}**\n\`\`\`\n${text.slice(0, 1800)}\n\`\`\``);
      if (requesterUserId !== targetUserId) {
        const requester = await interaction.client.users.fetch(requesterUserId).catch(() => null);
        await requester?.send(
          `✅ <@${targetUserId}> finished setting up WoW account **${username}** on **${server.name}**.`
        ).catch(() => {});
      }
    } catch (err: any) {
      await interaction.editReply(`❌ Account creation failed: ${err?.message || err}`);
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const cfg = this.cfg!;
    if (!this.channelAllowed(interaction.channelId)) {
      await interaction.reply({ content: '⛔ Bot commands are not allowed in this channel.', ephemeral: true });
      return;
    }
    const member = interaction.member as GuildMember | null;
    if (!member) return;

    if (!this.memberCan(member, 'commands')) {
      await interaction.reply({ content: '⛔ You do not have permission to use bot commands.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'servers') {
      await interaction.reply({ embeds: this.buildStatusEmbeds(monitor.getAll()), ephemeral: true });
      return;
    }

    const serverId = parseInt(interaction.options.getString('server') || '', 10);
    const server = getServerById(serverId);
    if (!server) {
      await interaction.reply({ content: 'Unknown server. Pick one from the autocomplete list.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'server') {
      const action = interaction.options.getString('action') as ServerAction;
      const permNeeded: DiscordPerm =
        action === 'pause' || action === 'unpause' ? 'restart' : (action as DiscordPerm);
      if (!this.memberCan(member, permNeeded)) {
        await interaction.reply({ content: `⛔ You do not have permission to ${action} servers.`, ephemeral: true });
        return;
      }
      if (!this.actionAllowed(action)) {
        await interaction.reply({ content: `⛔ The \`${action}\` action is disabled.`, ephemeral: true });
        return;
      }
      await interaction.deferReply();
      try {
        await performAction(server.container_name, action);
        await monitor.refresh();
        this.queueStatusUpdate();
        await interaction.editReply(`✅ **${server.name}**: \`${action}\` issued by ${interaction.user}.`);
      } catch (err: any) {
        await interaction.editReply(`❌ Failed to ${action} **${server.name}**: ${err?.message || err}`);
      }
      return;
    }

    if (interaction.commandName === 'rcon') {
      if (!cfg.allow_rcon || !this.memberCan(member, 'rcon')) {
        await interaction.reply({ content: '⛔ You do not have permission to use RCON.', ephemeral: true });
        return;
      }
      const command = interaction.options.getString('command') || '';
      if (!this.rconCommandAllowed(command)) {
        await interaction.reply({ content: '⛔ That RCON command is not on the allowed list.', ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const response = await sendRconCommand(server, command);
        const text = response.trim() || '(no response)';
        await interaction.editReply(`\`${command}\` → \`\`\`\n${text.slice(0, 1800)}\n\`\`\``);
      } catch (err: any) {
        await interaction.editReply(`❌ RCON failed: ${err?.message || err}`);
      }
      return;
    }

    if (interaction.commandName === 'broadcast') {
      if (!cfg.allow_broadcast || !this.memberCan(member, 'broadcast')) {
        await interaction.reply({ content: '⛔ You do not have permission to broadcast.', ephemeral: true });
        return;
      }
      const message = interaction.options.getString('message') || '';
      await interaction.deferReply();
      try {
        await sendBroadcast(server, message);
        await interaction.editReply(`📢 Sent to **${server.name}**: ${message}`);
      } catch (err: any) {
        await interaction.editReply(`❌ Broadcast failed: ${err?.message || err}`);
      }
      return;
    }

    if (interaction.commandName === 'wowcreate') {
      if (!this.memberCan(member, 'wowCreate')) {
        await interaction.reply({ content: '⛔ You do not have permission to create WoW accounts.', ephemeral: true });
        return;
      }
      if (server.game !== 'azerothcore') {
        await interaction.reply({ content: '⛔ That server is not an AzerothCore server.', ephemeral: true });
        return;
      }
      const targetUser = interaction.options.getUser('user', true);
      if (targetUser.bot) {
        await interaction.reply({ content: '⛔ Cannot create an account for a bot user.', ephemeral: true });
        return;
      }
      const usernameOption = interaction.options.getString('username');
      const username = sanitizeWowUsername(usernameOption || targetUser.username);
      const customId = `wowcreate:${server.id}:${targetUser.id}:${interaction.user.id}:${username}`;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(customId).setLabel('Set Password').setStyle(ButtonStyle.Primary)
      );
      await interaction.deferReply({ ephemeral: true });
      try {
        await targetUser.send({
          content:
            `👋 You've been invited to set up a WoW account (**${username}**) on **${server.name}**.\n` +
            `Click below and enter a password to finish setup.`,
          components: [row],
        });
        await interaction.editReply(`📨 Sent ${targetUser} a DM to set up account **${username}** on **${server.name}**.`);
      } catch {
        await interaction.editReply(`❌ Couldn't DM ${targetUser} — they may have DMs disabled for this server.`);
      }
    }
  }
}

export const discordBot = new DiscordBot();
