import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType,
  ChatInputCommandInteraction, Client, EmbedBuilder, GatewayIntentBits, GuildMember,
  Interaction, PermissionFlagsBits, REST, Routes, SlashCommandBuilder, TextChannel,
} from 'discord.js';
import {
  deleteStatusMessageId, getDiscordConfig, getServerById, getStatusMessageId,
  listDiscordRolePerms, listServers, listStatusMessages, setStatusMessageId,
} from '../db';
import { performAction } from '../docker';
import { monitor } from '../monitor';
import { getPublicIp } from '../publicIp';
import { sendBroadcast, sendRconCommand } from '../rcon';
import { delayScheduledRestart, getNextScheduledRestart } from '../scheduler';
import type { ContainerState, DiscordConfig, DiscordRolePerm, ServerAction, ServerStatus } from '../types';

type DiscordPerm = 'commands' | 'start' | 'stop' | 'restart' | 'rcon' | 'broadcast';

const PERM_COLUMN: Record<DiscordPerm, keyof DiscordRolePerm> = {
  commands: 'can_use_commands',
  start: 'can_start',
  stop: 'can_stop',
  restart: 'can_restart',
  rcon: 'can_rcon',
  broadcast: 'can_broadcast',
};

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

  private buildStatusEmbed(statuses: ServerStatus[]): EmbedBuilder {
    const allUp = statuses.length > 0 && statuses.every((s) => s.state === 'running');
    const anyUp = statuses.some((s) => s.state === 'running');
    const embed = new EmbedBuilder()
      .setTitle('🎮 Game Server Status')
      .setColor(allUp ? 0x3ba55d : anyUp ? 0xfaa61a : 0xed4245)
      .setTimestamp(new Date());
    if (statuses.length === 0) {
      embed.setDescription('No servers have been imported yet.');
      return embed;
    }

    const publicIp = getPublicIp();
    // Discord allows at most 25 fields per embed
    for (const s of statuses.slice(0, 25)) {
      const lines = [
        `**Game:** ${GAME_LABELS[s.game] || s.game}`,
        `**Uptime:** ${s.state === 'running' ? formatUptime(s.startedAt) : '—'}`,
      ];
      const nextRestart = getNextScheduledRestart(s.serverId);
      if (nextRestart) lines.push(`**Next restart:** <t:${Math.floor(nextRestart / 1000)}:R>`);
      if (publicIp && s.gamePort) lines.push(`**Server IP:** \`${publicIp}:${s.gamePort}\``);
      lines.push(`**Players:** ${s.playerCount != null ? s.playerCount : '—'}`);
      if (s.players && s.players.length > 0) {
        const shown = s.players.slice(0, MAX_EMBED_PLAYERS).join(', ');
        const extra = s.players.length > MAX_EMBED_PLAYERS ? ` +${s.players.length - MAX_EMBED_PLAYERS} more` : '';
        lines.push(shown + extra);
      }
      embed.addFields({
        name: `${STATE_EMOJI[s.state] || '❓'} ${s.name}`,
        value: lines.join('\n').slice(0, 1024),
        inline: false,
      });
    }
    return embed;
  }

  private buildButtons(statuses: ServerStatus[]): ActionRowBuilder<ButtonBuilder>[] {
    const cfg = this.cfg!;
    // Discord allows at most 5 action rows per message: one row per server, max 5
    return statuses.slice(0, 5).map((s) => {
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
      return row;
    }).filter((row) => row.components.length > 0);
  }

  /**
   * Maintains one status embed per channel. Each server chooses its channel
   * (discord_channel_id, falling back to the default status channel) and can
   * opt out of Discord display entirely (discord_show = 0).
   */
  private async updateStatusMessage(): Promise<void> {
    const cfg = this.cfg;
    if (!this.client?.isReady() || !cfg) return;

    const statusById = new Map(monitor.getAll().map((s) => [s.serverId, s]));
    const groups = new Map<string, ServerStatus[]>();
    for (const server of listServers()) {
      if (!server.discord_show) continue;
      const channelId = server.discord_channel_id || cfg.status_channel_id;
      if (!channelId) continue;
      const status = statusById.get(server.id);
      if (!status) continue;
      const group = groups.get(channelId);
      if (group) group.push(status);
      else groups.set(channelId, [status]);
    }

    for (const [channelId, statuses] of groups) {
      const channel = await this.client.channels.fetch(channelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel)) continue;
      const payload = { embeds: [this.buildStatusEmbed(statuses)], components: this.buildButtons(statuses) };
      const existingId = getStatusMessageId(channelId);
      if (existingId) {
        const existing = await channel.messages.fetch(existingId).catch(() => null);
        if (existing) {
          await existing.edit(payload).catch(() => {});
          continue;
        }
      }
      const msg = await channel.send(payload).catch(() => null);
      if (msg) setStatusMessageId(channelId, msg.id);
    }

    // Clean up embeds in channels that no longer display any server
    for (const row of listStatusMessages()) {
      if (groups.has(row.channel_id)) continue;
      const channel = await this.client.channels.fetch(row.channel_id).catch(() => null);
      if (channel instanceof TextChannel) {
        const msg = await channel.messages.fetch(row.message_id).catch(() => null);
        await msg?.delete().catch(() => {});
      }
      deleteStatusMessageId(row.channel_id);
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
      const servers = listServers()
        .filter((s) => s.name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((s) => ({ name: s.name, value: String(s.id) }));
      await interaction.respond(servers);
      return;
    }
    if (interaction.isButton()) {
      await this.handleButton(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      await this.handleCommand(interaction);
    }
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    const [prefix, action, idStr] = interaction.customId.split(':');
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
      await interaction.reply({ embeds: [this.buildStatusEmbed(monitor.getAll())], ephemeral: true });
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
    }
  }
}

export const discordBot = new DiscordBot();
