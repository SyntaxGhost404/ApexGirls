// Staff audit log: compact classic embeds posted to the configured log channel.
import { canPost } from '../core/permissions.js';
import { COLORS } from '../content/theme.js';

export class Audit {
  constructor(bot) {
    this.bot = bot;
    this.throttle = new Map();
  }

  /**
   * @param {string} guildId
   * @param {{ title: string, description?: string, color?: number, fields?: Array<{name:string,value:string,inline?:boolean}>, userId?: string, actorId?: string }} entry
   */
  async log(guildId, { title, description, color = COLORS.steel, fields = [], userId, actorId }) {
    const channelId = this.bot.settings.get(guildId).general.logChannelId;
    if (!channelId || !canPost(this.bot.cache, guildId, channelId, { embeds: true }).ok) return null;
    const embed = {
      title: title.slice(0, 256),
      color,
      timestamp: new Date().toISOString(),
      fields: fields.slice(0, 25).map((f) => ({ name: f.name.slice(0, 256), value: String(f.value || '—').slice(0, 1024), inline: f.inline ?? true })),
      footer: { text: 'Sanctuary Core · audit log' },
    };
    const lines = [];
    if (description) lines.push(description);
    if (userId) lines.push(`**Commander:** <@${userId}> \`${userId}\``);
    if (actorId) lines.push(`**By:** <@${actorId}>`);
    if (lines.length) embed.description = lines.join('\n').slice(0, 4096);
    try {
      return await this.bot.api.send(channelId, { embeds: [embed] });
    } catch (err) {
      this.bot.log.warn(`audit log post failed: ${err.message}`);
      return null;
    }
  }

  /** Throttled configuration warning (at most once per hour per key). */
  async warn(guildId, key, message) {
    const k = `${guildId}:${key}`;
    const last = this.throttle.get(k) || 0;
    if (Date.now() - last < 3_600_000) return;
    this.throttle.set(k, Date.now());
    this.bot.log.warn(`[${guildId}] ${message}`);
    await this.log(guildId, { title: '⚠️ Configuration warning', description: message, color: COLORS.warning });
  }
}
