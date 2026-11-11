// Giveaways: hosted by staff/event hosts, crypto-random winners, optional entry requirements,
// optional shard entry fee (a raffle-style sink), and UID claims for in-game prizes.
import { OptionType, UserError } from '../core/interactions.js';
import { button, container, label, modal, row, separator, text, textInput, v2, ButtonStyle, ChannelTypes, TextInputStyle } from '../core/components.js';
import { canPost } from '../core/permissions.js';
import { COLORS, ICON } from '../content/theme.js';
import { sample } from '../util/random.js';
import { discordTime, formatDuration, parseDuration, DAY, MINUTE } from '../util/time.js';
import { num, sanitizeInline } from '../util/format.js';
import { levelFor } from './leveling/curve.js';
import { isHost, requireGuild } from './common.js';
import { banner, success } from '../ui.js';

export class Giveaways {
  constructor(bot) {
    this.bot = bot;
    this.renderTimers = new Map();
  }

  get(id) {
    const g = this.bot.db.get('SELECT * FROM giveaways WHERE id = ?', Number(id));
    return g ? { ...g, winner_ids: JSON.parse(g.winner_ids || '[]') } : null;
  }

  entries(id) {
    return this.bot.db.get('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?', Number(id)).n;
  }

  render(g) {
    const settings = this.bot.settings.get(g.guild_id);
    const currency = this.bot.settings.currency(g.guild_id);
    const ended = g.status !== 'active';
    const n = this.entries(g.id);
    const req = [];
    if (g.min_level) req.push(`Level ${g.min_level}+`);
    if (g.role_id) req.push(`<@&${g.role_id}>`);
    if (g.entry_cost) req.push(`Entry ${currency.emoji} ${num(g.entry_cost)} (refunded if you leave early)`);
    if (g.requires_uid) req.push('In-game prize — winners submit their UID');
    const lines = [
      `## ${ICON.giveaway} ${ended ? 'Giveaway ended' : 'Sanctuary Giveaway'}`,
      `### ${sanitizeInline(g.prize, 150)}`,
    ];
    if (g.description) lines.push(sanitizeInline(g.description, 600));
    lines.push(`-# Hosted by <@${g.host_id}> · ${g.winners} winner${g.winners === 1 ? '' : 's'} · ${ended ? `ended ${discordTime(g.ends_at, 'R')}` : `ends ${discordTime(g.ends_at, 'F')} (${discordTime(g.ends_at, 'R')})`}`);
    if (req.length) lines.push(`**Requirements:** ${req.join(' · ')}`);
    lines.push(`🎟️ **${num(n)}** entr${n === 1 ? 'y' : 'ies'}`);
    if (ended) {
      lines.push(g.status === 'cancelled' ? '❌ Cancelled by the host — entry fees were refunded.' : g.winner_ids.length ? `🏆 **Winner${g.winner_ids.length === 1 ? '' : 's'}:** ${g.winner_ids.map((w) => `<@${w}>`).join(' ')}` : 'Not enough entries — no winner was drawn.');
    }
    return v2([container({ accent: ended ? COLORS.steel : COLORS.primary },
      banner(settings),
      text(lines.join('\n')),
      separator(),
      row(
        button({ id: `gw:enter:${g.id}`, label: ended ? 'Closed' : 'Enter', emoji: ICON.giveaway, style: ButtonStyle.Success, disabled: ended }),
        button({ id: `gw:leave:${g.id}`, label: 'Leave', emoji: '🚪', disabled: ended }),
        button({ id: `gw:odds:${g.id}`, label: 'My status', emoji: ICON.info }),
      ),
    )]);
  }

  scheduleRender(id) {
    if (this.renderTimers.has(id)) return;
    this.renderTimers.set(id, setTimeout(async () => {
      this.renderTimers.delete(id);
      const g = this.get(id);
      if (g?.message_id) await this.bot.api.edit(g.channel_id, g.message_id, this.render(g)).catch(() => null);
    }, 3_000));
  }

  async create(guildId, { channelId, hostId, prize, description, winners, durationMs, minLevel, roleId, entryCost, requiresUid }) {
    const check = canPost(this.bot.cache, guildId, channelId);
    if (!check.ok) throw new UserError(`I can't post in <#${channelId}> (missing ${check.missing.join(', ')}).`, { title: 'Missing permissions' });
    const now = Date.now();
    const res = this.bot.db.run(
      'INSERT INTO giveaways (guild_id, channel_id, host_id, prize, description, winners, entry_cost, min_level, role_id, requires_uid, status, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'active\', ?, ?)',
      guildId, channelId, hostId, prize, description || null, winners, entryCost || 0, minLevel || 0, roleId || null, requiresUid ? 1 : 0, now + durationMs, now,
    );
    const g = this.get(Number(res.lastInsertRowid));
    const msg = await this.bot.api.send(channelId, this.render(g));
    this.bot.db.run('UPDATE giveaways SET message_id = ? WHERE id = ?', msg.id, g.id);
    this.bot.scheduler.schedule(`giveaway:${g.id}`, 'giveaway.end', g.ends_at, { id: g.id });
    await this.bot.services.audit.log(guildId, { title: `${ICON.giveaway} Giveaway #${g.id} started`, actorId: hostId, color: COLORS.primary, fields: [{ name: 'Prize', value: prize }, { name: 'Winners', value: String(winners) }, { name: 'Ends', value: discordTime(g.ends_at, 'f') }] });
    return { ...g, message_id: msg.id };
  }

  enter(g, ctx) {
    if (g.status !== 'active' || Date.now() > g.ends_at) throw new UserError('This giveaway is closed.', { title: 'Closed', tone: 'warning' });
    if (this.bot.db.get('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?', g.id, ctx.userId)) throw new UserError('You are already entered — good luck, Commander!', { title: 'Already entered', tone: 'info' });
    const rec = this.bot.members.ensure(g.guild_id, ctx.userId);
    const level = levelFor(rec.xp, this.bot.settings.get(g.guild_id).leveling.curveScale);
    if (level < g.min_level) throw new UserError(`This giveaway requires **level ${g.min_level}** — you are level ${level}.`, { title: 'Requirement not met', tone: 'warning' });
    if (g.role_id && !ctx.memberRoles.includes(g.role_id)) throw new UserError(`This giveaway requires the <@&${g.role_id}> role.`, { title: 'Requirement not met', tone: 'warning' });
    this.bot.db.tx(() => {
      if (g.entry_cost) this.bot.economy.debit(g.guild_id, ctx.userId, g.entry_cost, 'giveaway', { reason: `Giveaway #${g.id} entry`, ref: g.id });
      this.bot.db.run('INSERT INTO giveaway_entries (giveaway_id, user_id, created_at) VALUES (?, ?, ?)', g.id, ctx.userId, Date.now());
    });
    this.bot.activity({ type: 'event', guildId: g.guild_id, userId: ctx.userId, key: `giveaway:${g.id}` });
    this.scheduleRender(g.id);
  }

  leave(g, userId) {
    if (g.status !== 'active') throw new UserError('This giveaway is already closed.', { title: 'Closed', tone: 'warning' });
    const had = this.bot.db.get('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?', g.id, userId);
    if (!had) throw new UserError('You are not entered in this giveaway.', { title: 'Not entered', tone: 'warning' });
    this.bot.db.tx(() => {
      this.bot.db.run('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?', g.id, userId);
      if (g.entry_cost) this.bot.economy.credit(g.guild_id, userId, g.entry_cost, 'refund', { reason: `Left giveaway #${g.id}`, ref: g.id });
    });
    this.scheduleRender(g.id);
  }

  /** Draw winners (idempotent for already-ended giveaways). */
  async end(id, { reroll = false, by = null } = {}) {
    const g = this.get(id);
    if (!g) return null;
    if (g.status === 'cancelled' || (g.status === 'ended' && !reroll)) return g;
    const pool = this.bot.db.all('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?', g.id).map((r) => r.user_id).filter((u) => !g.winner_ids.includes(u));
    const count = reroll ? 1 : g.winners;
    const picked = sample(pool, count);
    const winners = reroll ? [...g.winner_ids, ...picked] : picked;
    this.bot.db.run("UPDATE giveaways SET status = 'ended', winner_ids = ?, ends_at = ? WHERE id = ?", JSON.stringify(winners), reroll ? g.ends_at : Math.min(Date.now(), g.ends_at), g.id);
    this.bot.scheduler.cancel(`giveaway:${g.id}`);
    const updated = this.get(g.id);
    if (g.message_id) await this.bot.api.edit(g.channel_id, g.message_id, this.render(updated)).catch(() => null);
    for (const w of picked) {
      this.bot.members.bumpStat(g.guild_id, w, 'giveaway_wins');
      const guild = this.bot.cache.guild(g.guild_id);
      await this.bot.api.dm(w, {
        embeds: [{
          title: `${ICON.giveaway} You won: ${g.prize}`.slice(0, 256),
          description: g.requires_uid
            ? 'Congratulations, Commander! This is an **in-game prize** — press **Claim prize** and confirm your game version, server and UID so the staff team can deliver it.'
            : 'Congratulations, Commander! The staff team will contact you about your prize.',
          color: COLORS.gold,
          footer: { text: guild ? `${guild.name} · Sanctuary Core` : 'Sanctuary Core' },
        }],
        components: g.requires_uid ? [row(button({ id: `gw:claim:${g.id}:${g.guild_id}`, label: 'Claim prize', emoji: '📮', style: ButtonStyle.Success }))] : [],
      });
    }
    if (picked.length && canPost(this.bot.cache, g.guild_id, g.channel_id).ok) {
      await this.bot.api.send(g.channel_id, {
        ...v2([container({ accent: COLORS.gold }, text(`### ${ICON.trophy} ${reroll ? 'Giveaway reroll' : 'Giveaway winners'}\n${picked.map((w) => `<@${w}>`).join(' ')} won **${sanitizeInline(g.prize, 150)}**!${g.requires_uid ? '\n-# Winners: check your DMs to claim. DMs closed? Use `/giveaway claim` in the server.' : ''}`))], { mentions: picked }),
        message_reference: g.message_id ? { message_id: g.message_id, fail_if_not_exists: false } : undefined,
      }).catch(() => null);
    }
    await this.bot.services.audit.log(g.guild_id, { title: `${ICON.giveaway} Giveaway #${g.id} ${reroll ? 'rerolled' : 'ended'}`, actorId: by || g.host_id, color: COLORS.gold, fields: [{ name: 'Prize', value: g.prize }, { name: 'Winners', value: picked.map((w) => `<@${w}>`).join(' ') || 'none' }, { name: 'Entries', value: String(this.entries(g.id)) }] });
    return updated;
  }

  async cancel(id, by) {
    const g = this.get(id);
    if (!g || g.status !== 'active') throw new UserError('Only active giveaways can be cancelled.', { title: 'Cannot cancel', tone: 'warning' });
    this.bot.db.tx(() => {
      if (g.entry_cost) {
        for (const e of this.bot.db.all('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?', g.id)) this.bot.economy.credit(g.guild_id, e.user_id, g.entry_cost, 'refund', { reason: `Giveaway #${g.id} cancelled`, ref: g.id });
      }
      this.bot.db.run("UPDATE giveaways SET status = 'cancelled' WHERE id = ?", g.id);
    });
    this.bot.scheduler.cancel(`giveaway:${g.id}`);
    const updated = this.get(g.id);
    if (g.message_id) await this.bot.api.edit(g.channel_id, g.message_id, this.render(updated)).catch(() => null);
    await this.bot.services.audit.log(g.guild_id, { title: `${ICON.giveaway} Giveaway #${g.id} cancelled`, actorId: by, color: COLORS.danger, fields: [{ name: 'Prize', value: g.prize }] });
    return updated;
  }

  async claim(ctx, id, guildId) {
    const g = this.get(id);
    if (!g || g.guild_id !== guildId || !g.winner_ids.includes(ctx.userId)) throw new UserError('Only winners of that giveaway can claim it.', { title: 'Not a winner', tone: 'warning' });
    if (!g.requires_uid) throw new UserError('This prize is delivered by the host directly.', { title: 'No claim needed', tone: 'info' });
    if (this.bot.db.get("SELECT 1 FROM requisitions WHERE guild_id = ? AND user_id = ? AND source = 'giveaway' AND item_id = ? AND status != 'cancelled'", guildId, ctx.userId, g.id)) {
      throw new UserError('You already claimed this prize — the staff team is on it.', { title: 'Already claimed', tone: 'info' });
    }
    const rec = this.bot.members.ensure(guildId, ctx.userId);
    return ctx.showModal(this.bot.services.requisitions.detailsModal(`gw:claimsave:${g.id}:${guildId}`, `Claim: ${g.prize}`, rec));
  }
}

export default function setup(bot) {
  const gws = new Giveaways(bot);
  bot.services.giveaways = gws;
  bot.scheduler.register('giveaway.end', async ({ id }) => {
    await gws.end(id);
  });

  bot.router.command({
    name: 'giveaway',
    description: 'Run and manage community giveaways.',
    options: [
      {
        type: OptionType.Subcommand,
        name: 'start',
        description: 'Start a giveaway (staff & event hosts).',
        options: [
          { type: OptionType.Channel, name: 'channel', description: 'Where to post it (default: here)', channel_types: [ChannelTypes.GuildText, ChannelTypes.GuildAnnouncement] },
          { type: OptionType.Role, name: 'required_role', description: 'Only members with this role may enter' },
          { type: OptionType.Integer, name: 'entry_cost', description: 'Core Shards needed to enter (raffle style)', min_value: 0, max_value: 1_000_000 },
          { type: OptionType.Boolean, name: 'in_game_prize', description: 'Winners submit their UID for staff delivery' },
        ],
      },
      { type: OptionType.Subcommand, name: 'list', description: 'Active and recent giveaways with host controls.' },
      { type: OptionType.Subcommand, name: 'claim', description: 'Claim an in-game prize you won (if your DMs are closed).' },
    ],
    async run(ctx) {
      const guildId = requireGuild(ctx);
      if (ctx.subcommand === 'claim') {
        const won = bot.db.all("SELECT id, prize, winner_ids FROM giveaways WHERE guild_id = ? AND status = 'ended' AND requires_uid = 1 ORDER BY id DESC LIMIT 25", guildId)
          .filter((g) => JSON.parse(g.winner_ids).includes(ctx.userId))
          .filter((g) => !bot.db.get("SELECT 1 FROM requisitions WHERE guild_id = ? AND user_id = ? AND source = 'giveaway' AND item_id = ? AND status != 'cancelled'", guildId, ctx.userId, g.id));
        if (!won.length) throw new UserError('You have no unclaimed in-game giveaway prizes.', { title: 'Nothing to claim', tone: 'info' });
        return gws.claim(ctx, won[0].id, guildId);
      }
      if (!isHost(bot, ctx)) throw new UserError('Only staff and event hosts can manage giveaways.', { title: 'Hosts only' });
      if (ctx.subcommand === 'list') return ctx.reply(renderList(guildId));
      const channelId = ctx.option('channel') || ctx.channelId;
      const roleId = ctx.option('required_role');
      const entry = ctx.option('entry_cost', 0);
      const uid = ctx.option('in_game_prize', false) ? 1 : 0;
      return ctx.showModal(modal({
        id: `gw:create:${channelId}:${roleId || '0'}:${entry}:${uid}`,
        title: 'Start a giveaway',
        components: [
          label('Prize', textInput({ id: 'prize', max: 150, placeholder: 'e.g. Advanced Echo Permit ×5' })),
          label('Winners', textInput({ id: 'winners', max: 2, value: '1' }), '1–20'),
          label('Duration', textInput({ id: 'duration', max: 12, value: '24h', placeholder: '30m, 2h, 3d, 1w' }), 'Between 1 minute and 30 days'),
          label('Minimum level', textInput({ id: 'level', max: 3, value: '0', required: false })),
          label('Description', textInput({ id: 'desc', style: TextInputStyle.Paragraph, max: 600, required: false, placeholder: 'Optional details, rules or flavour text' })),
        ],
      }));
    },
  });

  function renderList(guildId) {
    const list = bot.db.all("SELECT * FROM giveaways WHERE guild_id = ? AND (status = 'active' OR ends_at > ?) ORDER BY id DESC LIMIT 6", guildId, Date.now() - 7 * DAY).map((g) => ({ ...g, winner_ids: JSON.parse(g.winner_ids) }));
    const parts = [text(`## ${ICON.giveaway} Giveaways\n-# Active and last-7-days giveaways`)];
    if (!list.length) parts.push(text('*No giveaways right now. Start one with `/giveaway start`.*'));
    for (const g of list) {
      parts.push(separator());
      parts.push(text(`**#${g.id} · ${sanitizeInline(g.prize, 80)}** — ${g.status}\n-# ${num(gws.entries(g.id))} entries · ${g.status === 'active' ? `ends ${discordTime(g.ends_at, 'R')}` : `ended ${discordTime(g.ends_at, 'R')}`} · <#${g.channel_id}>`));
      parts.push(row(
        button({ id: `gw:endnow:${g.id}`, label: 'End now', emoji: '⏹️', disabled: g.status !== 'active' }),
        button({ id: `gw:reroll:${g.id}`, label: 'Reroll 1', emoji: '🎲', disabled: g.status !== 'ended' }),
        button({ id: `gw:cancel:${g.id}`, label: 'Cancel & refund', emoji: '❌', style: ButtonStyle.Danger, disabled: g.status !== 'active' }),
      ));
    }
    return v2([container({ accent: COLORS.primary }, ...parts)], { ephemeral: true });
  }

  bot.router.modal('gw', async (ctx, action, a, b, c, d) => {
    if (action === 'claimsave') {
      const guildId = b;
      const g = gws.get(a);
      if (!g || !g.winner_ids.includes(ctx.userId)) throw new UserError('Only winners can claim this prize.', { title: 'Not a winner', tone: 'warning' });
      const details = bot.services.requisitions.readDetails(ctx);
      const r = await bot.services.requisitions.file(guildId, ctx.userId, { source: 'giveaway', itemId: g.id, title: g.prize, quantity: 1, cost: 0, ...details });
      bot.members.update(guildId, ctx.userId, { game_region: details.region, game_server: details.server, game_uid: details.uid });
      await ctx.reply(success('Prize claimed', `Requisition **#${r.id}** is with the staff team. You'll get a DM when it ships.`));
      return;
    }
    const guildId = requireGuild(ctx);
    if (!isHost(bot, ctx)) throw new UserError('Only staff and event hosts can start giveaways.', { title: 'Hosts only' });
    if (action !== 'create') return;
    const prize = String(ctx.field('prize', '') || '').trim();
    if (!prize) throw new UserError('Give the prize a name.', { title: 'Missing prize', tone: 'warning' });
    const winners = Number.parseInt(ctx.field('winners', '1'), 10);
    if (!Number.isFinite(winners) || winners < 1 || winners > 20) throw new UserError('Winners must be between 1 and 20.', { title: 'Invalid winners', tone: 'warning' });
    const duration = parseDuration(ctx.field('duration', '24h'));
    if (!duration || duration < MINUTE || duration > 30 * DAY) throw new UserError('Use a duration like `30m`, `2h`, `3d` (1 minute – 30 days).', { title: 'Invalid duration', tone: 'warning' });
    const level = Number.parseInt(ctx.field('level', '0') || '0', 10) || 0;
    const g = await gws.create(guildId, {
      channelId: a,
      hostId: ctx.userId,
      prize,
      description: String(ctx.field('desc', '') || '').trim(),
      winners,
      durationMs: duration,
      minLevel: Math.max(0, Math.min(500, level)),
      roleId: b && b !== '0' ? b : null,
      entryCost: Math.max(0, Number(c) || 0),
      requiresUid: d === '1',
    });
    await ctx.reply(success('Giveaway live', `**${sanitizeInline(prize, 100)}** is running in <#${g.channel_id}> for ${formatDuration(duration, { short: false })}. Manage it with \`/giveaway list\`.`));
  });

  bot.router.component('gw', async (ctx, action, id, guildArg) => {
    if (action === 'claim') return gws.claim(ctx, id, guildArg);
    const guildId = requireGuild(ctx);
    const g = gws.get(id);
    if (!g || g.guild_id !== guildId) throw new UserError('That giveaway no longer exists.', { title: 'Not found', tone: 'warning' });
    switch (action) {
      case 'enter': {
        gws.enter(g, ctx);
        const currency = bot.settings.currency(guildId);
        return ctx.reply(success('You are in!', `Entered **${sanitizeInline(g.prize, 100)}**${g.entry_cost ? ` for ${currency.fmt(g.entry_cost)}` : ''}. Winners are drawn ${discordTime(g.ends_at, 'R')}.`));
      }
      case 'leave':
        gws.leave(g, ctx.userId);
        return ctx.reply(success('Entry withdrawn', g.entry_cost ? 'Your entry fee was refunded.' : 'You left the giveaway.'));
      case 'odds': {
        const entered = Boolean(bot.db.get('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?', g.id, ctx.userId));
        const n = gws.entries(g.id);
        const odds = entered && n ? Math.min(100, (g.winners / n) * 100) : 0;
        return ctx.reply(v2([container({ accent: COLORS.info }, text(`### ${ICON.info} ${sanitizeInline(g.prize, 100)}\n${entered ? `You are entered. Current odds ≈ **${odds.toFixed(odds < 10 ? 1 : 0)}%** (${g.winners} winner${g.winners === 1 ? '' : 's'} / ${num(n)} entries).` : 'You have not entered yet.'}${g.winner_ids.includes(ctx.userId) ? '\n🏆 **You won this giveaway!**' : ''}`))], { ephemeral: true }));
      }
      case 'endnow':
      case 'reroll':
      case 'cancel': {
        if (!isHost(bot, ctx)) throw new UserError('Only staff and event hosts can do that.', { title: 'Hosts only' });
        if (action === 'endnow') await gws.end(g.id, { by: ctx.userId });
        else if (action === 'reroll') {
          if (g.status !== 'ended') throw new UserError('Only ended giveaways can be rerolled.', { title: 'Not ended', tone: 'warning' });
          await gws.end(g.id, { reroll: true, by: ctx.userId });
        } else await gws.cancel(g.id, ctx.userId);
        return ctx.update(renderList(guildId));
      }
      default:
        return undefined;
    }
  });
}
