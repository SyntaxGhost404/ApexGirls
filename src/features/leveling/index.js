// Leveling engine: chat XP (quality-gated, cooldown, soft/hard daily caps, conversation bonus),
// voice XP (requires company, no self-deaf/mute farming), level-ups with shard rewards, role
// rewards and themed announcements.
import { analyzeMessage } from './spam.js';
import { levelProgress, levelShards } from './curve.js';
import { dayKey } from '../../util/time.js';
import { randInt } from '../../util/random.js';
import { canAssignRole, canPost, botChannelPermissions, has, P } from '../../core/permissions.js';
import { container, section, thumbnail, v2 } from '../../core/components.js';
import { COLORS, FACTIONS, ICON, rankFor } from '../../content/theme.js';
import { avatarUrl } from '../../util/format.js';

const THREAD_TYPES = new Set([10, 11, 12]);

export class Leveling {
  constructor(bot) {
    this.bot = bot;
    this.log = bot.log.child('leveling');
    this.recent = new Map();
    this.channelActivity = new Map();
    this.channelFetches = new Map();
  }

  channelMultiplier(settings, lineage) {
    for (const id of lineage) {
      const m = settings.leveling.channelMultipliers[id];
      if (m !== undefined && m !== null) return Math.max(0, m) / 100;
    }
    return 1;
  }

  roleMultiplier(settings, roles) {
    let best = 1;
    for (const r of roles) {
      const m = settings.leveling.roleMultipliers[r];
      if (m !== undefined && m !== null) best = Math.max(best, m / 100);
    }
    return best;
  }

  isBlocked(settings, lineage, roles) {
    const s = settings.leveling;
    return lineage.some((id) => s.noXpChannelIds.includes(id) || s.channelMultipliers[id] === 0) || roles.some((r) => s.noXpRoleIds.includes(r));
  }

  boost(row, now = Date.now()) {
    return row?.boost_until && row.boost_until > now ? (row.boost_mult || 100) / 100 : 1;
  }

  /** Channel → parent → category ids; fetches unknown channels (e.g. old threads) once. */
  async lineage(guildId, channelId) {
    if (!this.bot.cache.channel(guildId, channelId)) {
      if (!this.channelFetches.has(channelId)) {
        this.channelFetches.set(channelId, this.bot.api.channel(channelId).then((ch) => {
          if (ch?.guild_id) this.bot.cache.handle(THREAD_TYPES.has(ch.type) ? 'THREAD_UPDATE' : 'CHANNEL_UPDATE', ch);
          return ch;
        }).catch(() => null));
        if (this.channelFetches.size > 5_000) this.channelFetches.clear();
      }
      await this.channelFetches.get(channelId);
    }
    return this.bot.cache.channelLineage(guildId, channelId);
  }

  /** Track speakers per channel; returns how many *other* members spoke in the last 3 minutes. */
  trackConversation(channelId, userId, now) {
    const list = (this.channelActivity.get(channelId) || []).filter((e) => now - e.ts < 180_000);
    const others = new Set(list.filter((e) => e.userId !== userId).map((e) => e.userId)).size;
    list.push({ userId, ts: now });
    this.channelActivity.set(channelId, list.slice(-60));
    return others;
  }

  async onMessage(msg) {
    if (!msg.guild_id || !msg.author || msg.author.bot || msg.webhook_id || msg.author.system) return;
    if (msg.type !== 0 && msg.type !== 19) return;
    const guildId = msg.guild_id;
    const userId = msg.author.id;
    const now = Date.now();
    const settings = this.bot.settings.get(guildId);
    const othersActive = this.trackConversation(msg.channel_id, userId, now);
    if (!settings.leveling.enabled) return;

    const roles = msg.member?.roles || [];
    const lineage = await this.lineage(guildId, msg.channel_id);
    if (this.isBlocked(settings, lineage, roles)) return;

    const key = `${guildId}:${userId}`;
    const recent = this.recent.get(key) || [];
    const verdict = analyzeMessage(msg.content, {
      attachments: msg.attachments?.length || 0,
      stickers: msg.sticker_items?.length || 0,
      minChars: settings.leveling.minChars,
      recent,
      hasContent: this.bot.contentIntent,
    });
    if (verdict.normalized) this.recent.set(key, [verdict.normalized, ...recent].slice(0, 3));
    if (this.recent.size > 20_000) this.recent.clear();
    if (!verdict.ok) return;

    const s = settings.leveling;
    const row = this.bot.members.ensure(guildId, userId);
    if (row.left_guild) this.bot.members.update(guildId, userId, { left_guild: 0 });
    if (now - row.last_xp_at < s.cooldownSec * 1000) return;

    const today = dayKey(now, settings.general.resetHour);
    const day = this.bot.members.day(row, today);
    const ref = msg.referenced_message?.author;
    const replyTarget = msg.message_reference?.type !== 1 && ref && !ref.bot && ref.id !== userId ? ref.id : null;
    const conversation = Boolean(replyTarget) || othersActive >= 2;

    let mult = this.channelMultiplier(settings, lineage) * this.roleMultiplier(settings, roles) * this.bot.state.surge(guildId) * this.boost(row, now) * (verdict.quality ?? 1);
    if (conversation) mult *= 1 + s.conversationBonus / 100;
    if (day.day_chat_xp >= s.hardCap) mult = 0;
    else if (day.day_chat_xp >= s.softCap) mult *= 0.5;
    const base = randInt(s.chatXpMin, Math.max(s.chatXpMin, s.chatXpMax));
    const xp = Math.max(0, Math.min(Math.round(base * mult), s.hardCap - day.day_chat_xp));
    const shards = mult > 0 ? Math.max(0, Math.min(s.shardsPerMessage, s.chatShardsDailyCap - day.day_chat_shards)) : 0;

    this.bot.db.tx(() => {
      this.bot.members.update(guildId, userId, {
        last_xp_at: now,
        day_key: today,
        day_chat_xp: day.day_chat_xp + xp,
        day_chat_shards: day.day_chat_shards + shards,
        day_voice_xp: day.day_voice_xp,
        day_expeditions: day.day_expeditions,
        day_duels: day.day_duels,
      });
      this.bot.members.increment(guildId, userId, { messages: 1 });
      if (shards) this.bot.economy.credit(guildId, userId, shards, 'chat', { log: false });
    });

    const result = xp > 0 ? this.addXp(guildId, userId, xp, { source: 'chat', channelId: msg.channel_id, messageId: msg.id }) : null;
    this.bot.activity({ type: 'message', guildId, userId, channelId: msg.channel_id, lineage, level: result?.after ?? row.level });
    if (replyTarget) this.bot.activity({ type: 'reply', guildId, userId, key: replyTarget });
  }

  /**
   * Add (or remove) lifetime XP. Handles level computation, season/weekly ladders, level-up shards,
   * role rewards and announcements.
   */
  addXp(guildId, userId, amount, { source = 'system', channelId = null, messageId = null, silent = false, log = false, actor = null, reason = null } = {}) {
    const settings = this.bot.settings.get(guildId);
    const scale = settings.leveling.curveScale;
    const outcome = this.bot.db.tx(() => {
      const row = this.bot.members.ensure(guildId, userId);
      const xp = Math.max(0, row.xp + Math.round(amount));
      const delta = xp - row.xp;
      const level = levelProgress(xp, scale).level;
      this.bot.db.run(
        'UPDATE members SET xp = ?, level = ?, season_xp = MAX(0, season_xp + ?), weekly_xp = MAX(0, weekly_xp + ?), updated_at = ? WHERE guild_id = ? AND user_id = ?',
        xp, level, delta, delta, Date.now(), guildId, userId,
      );
      if (log && delta) this.bot.economy.logXp(guildId, userId, delta, xp, source, { actor, reason });
      let shards = 0;
      if (delta > 0 && level > row.level) for (let l = row.level + 1; l <= level; l += 1) shards += levelShards(l, settings);
      if (shards > 0) this.bot.economy.credit(guildId, userId, shards, 'levelup', { reason: `Reached level ${level}` });
      return { before: row.level, after: level, xp, delta, shards };
    });
    if (outcome.delta > 0) this.bot.activity({ type: 'xp', guildId, userId, amount: outcome.delta, source });
    if (outcome.after > outcome.before && outcome.delta > 0 && !silent) {
      this.#onLevelUp(guildId, userId, outcome, { channelId, messageId, source }).catch((err) => this.log.error('level-up handling failed', err));
    }
    return outcome;
  }

  async #onLevelUp(guildId, userId, outcome, ctx) {
    const granted = await this.syncRewardRoles(guildId, userId, outcome.after).catch((err) => {
      this.log.warn(`reward roles failed: ${err.message}`);
      return [];
    });
    this.bot.activity({ type: 'levelup', guildId, userId, level: outcome.after });
    await this.#announce(guildId, userId, outcome, granted, ctx);
  }

  /** Make sure the member holds the reward roles for `level`. Returns newly granted role ids. */
  async syncRewardRoles(guildId, userId, level) {
    const s = this.bot.settings.get(guildId).leveling;
    const earned = [...s.rewards].filter((r) => r.roleId && r.level > 0 && r.level <= level).sort((a, b) => a.level - b.level);
    if (!earned.length) return [];
    let roles = this.bot.cache.member(guildId, userId)?.roles;
    if (!roles?.length) {
      const m = await this.bot.api.member(guildId, userId);
      if (!m) return [];
      roles = m.roles;
    }
    const want = s.stackRewards ? earned.map((r) => r.roleId) : [earned[earned.length - 1].roleId];
    const drop = s.stackRewards ? [] : earned.slice(0, -1).map((r) => r.roleId).filter((id) => roles.includes(id) && !want.includes(id));
    const granted = [];
    for (const roleId of want) {
      if (roles.includes(roleId)) continue;
      const check = canAssignRole(this.bot.cache, guildId, roleId);
      if (!check.ok) {
        await this.bot.services.audit.warn(guildId, `reward:${roleId}`, `A level reward role could not be assigned: ${check.reason}`);
        continue;
      }
      await this.bot.api.addRole(guildId, userId, roleId, `Level ${level} reward`);
      granted.push(roleId);
    }
    for (const roleId of drop) {
      if (canAssignRole(this.bot.cache, guildId, roleId).ok) await this.bot.api.removeRole(guildId, userId, roleId, 'Replaced by a higher level reward').catch(() => null);
    }
    const cached = this.bot.cache.member(guildId, userId);
    if (cached) cached.roles = [...new Set([...roles.filter((r) => !drop.includes(r)), ...granted])];
    return granted;
  }

  async #announce(guildId, userId, outcome, granted, ctx) {
    const settings = this.bot.settings.get(guildId);
    const s = settings.leveling;
    if (s.announceMode === 'off' || outcome.after < s.announceFromLevel) return;
    const row = this.bot.members.get(guildId, userId);
    const ping = Boolean(s.announcePing && row?.levelup_ping);
    const rank = rankFor(outcome.after);
    const promoted = rank.name !== rankFor(outcome.before).name;
    const currency = this.bot.settings.currency(guildId);
    const member = this.bot.cache.member(guildId, userId);
    const avatar = avatarUrl({ id: userId, avatar: member?.avatar }, { guildId, guildAvatar: member?.guildAvatar, size: 128 });
    const accent = promoted ? COLORS.gold : FACTIONS[row?.faction]?.color ?? COLORS.primary;
    const headline = promoted
      ? `### ${rank.emoji} Promotion · ${rank.name}\n<@${userId}> reached **level ${outcome.after}** and now holds the rank of **${rank.name}**.\n*${rank.blurb}*`
      : `### ${ICON.level} Level ${outcome.after}\n<@${userId}> climbed to **level ${outcome.after}** · ${rank.emoji} ${rank.name}`;
    const perks = [];
    if (outcome.shards) perks.push(`+${currency.emoji} ${outcome.shards.toLocaleString('en-US')} ${currency.name}`);
    if (granted.length) perks.push(`unlocked ${granted.map((r) => `<@&${r}>`).join(' ')}`);
    const payload = v2([container({ accent }, section([headline, perks.length ? `-# ${perks.join(' · ')}` : '-# Keep chatting to climb the ladder.'], thumbnail(avatar, 'Commander avatar')))], { mentions: ping ? [userId] : [] });

    if (s.announceMode === 'dm') {
      await this.bot.api.dm(userId, { ...payload, allowed_mentions: { parse: [] } });
      return;
    }
    let channelId = null;
    let reply = false;
    if (s.announceMode === 'current' && ctx.source === 'chat' && ctx.channelId && canPost(this.bot.cache, guildId, ctx.channelId).ok) {
      channelId = ctx.channelId;
      reply = Boolean(ctx.messageId) && has(botChannelPermissions(this.bot.cache, guildId, channelId), P.READ_MESSAGE_HISTORY);
    } else if (s.announceChannelId && canPost(this.bot.cache, guildId, s.announceChannelId).ok) {
      channelId = s.announceChannelId;
    } else if (ctx.channelId && ctx.source === 'chat' && canPost(this.bot.cache, guildId, ctx.channelId).ok) {
      channelId = ctx.channelId;
    }
    if (!channelId) return;
    if (reply) payload.message_reference = { message_id: ctx.messageId, fail_if_not_exists: false };
    await this.bot.api.send(channelId, payload).catch((err) => this.log.warn(`level-up announcement failed: ${err.message}`));
  }

  /** Called every minute: award voice XP to members talking with others. */
  tickVoice() {
    const now = Date.now();
    for (const guild of this.bot.cache.guilds.values()) {
      if (!guild.voice.size) continue;
      const settings = this.bot.settings.get(guild.id);
      const v = settings.voice;
      if (!v.enabled || !settings.leveling.enabled) continue;
      const byChannel = new Map();
      for (const [userId, state] of guild.voice) {
        if (!state.channelId || state.channelId === guild.afkChannelId) continue;
        if (!byChannel.has(state.channelId)) byChannel.set(state.channelId, []);
        byChannel.get(state.channelId).push({ userId, ...state });
      }
      for (const [channelId, states] of byChannel) {
        const humans = states.filter((s) => !s.bot && !this.bot.cache.member(guild.id, s.userId)?.bot);
        if (humans.length < v.minHumans) continue;
        for (const h of humans) {
          if (h.selfDeaf || h.deaf || h.suppress) continue;
          if (v.requireUnmuted && (h.selfMute || h.mute)) continue;
          this.#voiceMinute(guild.id, h.userId, channelId, settings, now);
        }
      }
    }
  }

  #voiceMinute(guildId, userId, channelId, settings, now) {
    const roles = this.bot.cache.member(guildId, userId)?.roles || [];
    const lineage = this.bot.cache.channelLineage(guildId, channelId);
    if (this.isBlocked(settings, lineage, roles)) return;
    const row = this.bot.members.ensure(guildId, userId);
    const today = dayKey(now, settings.general.resetHour);
    const day = this.bot.members.day(row, today);
    const v = settings.voice;
    const mult = this.channelMultiplier(settings, lineage) * this.roleMultiplier(settings, roles) * this.bot.state.surge(guildId) * this.boost(row, now);
    const xp = day.day_voice_xp >= v.dailyXpCap ? 0 : Math.max(0, Math.min(Math.round(v.xpPerMinute * mult), v.dailyXpCap - day.day_voice_xp));
    const minutes = row.voice_minutes + 1;
    const shards = minutes % 10 === 0 && xp > 0 ? v.shardsPer10Min : 0;
    this.bot.db.tx(() => {
      this.bot.members.update(guildId, userId, {
        voice_minutes: minutes,
        day_key: today,
        day_voice_xp: day.day_voice_xp + xp,
        day_chat_xp: day.day_chat_xp,
        day_chat_shards: day.day_chat_shards,
        day_expeditions: day.day_expeditions,
        day_duels: day.day_duels,
      });
      if (shards) this.bot.economy.credit(guildId, userId, shards, 'voice', { log: false });
    });
    if (xp > 0) this.addXp(guildId, userId, xp, { source: 'voice', channelId });
    this.bot.activity({ type: 'voice', guildId, userId, amount: 1 });
  }

  onReaction(d) {
    if (!d.guild_id || d.member?.user?.bot || d.user_id === d.message_author_id) return;
    if (this.bot.cache.member(d.guild_id, d.user_id)?.bot) return;
    this.bot.activity({ type: 'reaction', guildId: d.guild_id, userId: d.user_id, key: d.message_id });
  }

  /** Recompute stored levels after the XP curve changes (no announcements or rewards). */
  recomputeLevels(guildId) {
    const scale = this.bot.settings.get(guildId).leveling.curveScale;
    const rows = this.bot.db.all('SELECT user_id, xp FROM members WHERE guild_id = ?', guildId);
    this.bot.db.tx(() => {
      for (const r of rows) this.bot.db.run('UPDATE members SET level = ? WHERE guild_id = ? AND user_id = ?', levelProgress(r.xp, scale).level, guildId, r.user_id);
    });
    return rows.length;
  }
}

export default function setup(bot) {
  const leveling = new Leveling(bot);
  bot.services.leveling = leveling;
  bot.on('MESSAGE_CREATE', (msg) => leveling.onMessage(msg));
  bot.on('MESSAGE_REACTION_ADD', (d) => leveling.onReaction(d));
  bot.on('GUILD_MEMBER_ADD', (d) => {
    if (bot.members.get(d.guild_id, d.user.id)) bot.members.update(d.guild_id, d.user.id, { left_guild: 0 });
  });
  bot.on('GUILD_MEMBER_REMOVE', (d) => {
    if (d.user && bot.members.get(d.guild_id, d.user.id)) bot.members.update(d.guild_id, d.user.id, { left_guild: 1 });
  });
  bot.scheduler.every('voice-xp', 60_000, () => leveling.tickVoice());
}
