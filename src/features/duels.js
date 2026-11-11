// Faction Clash duels: two Commanders secretly lock in a faction; the counter loop decides.
// Stakes are escrowed on acceptance, draws refund, a small "Sanctuary tax" acts as a shard sink.
import { OptionType, UserError } from '../core/interactions.js';
import { button, container, row, separator, text, v2, ButtonStyle } from '../core/components.js';
import { COLORS, FACTIONS, FACTION_KEYS, ICON, matchup } from '../content/theme.js';
import { dayKey, discordTime, MINUTE } from '../util/time.js';
import { num } from '../util/format.js';
import { requireGuild } from './common.js';

const PENDING_MS = 2 * MINUTE;
const ACTIVE_MS = 3 * MINUTE;

export function resolveDuel(a, b) {
  const m = matchup(a, b);
  return m > 0 ? 'challenger' : m < 0 ? 'opponent' : 'draw';
}

export class Duels {
  constructor(bot) {
    this.bot = bot;
  }

  get(id) {
    return this.bot.db.get('SELECT * FROM duels WHERE id = ?', Number(id));
  }

  render(d) {
    const currency = this.bot.settings.currency(d.guild_id);
    const stake = d.stake ? `${currency.emoji} **${num(d.stake)}** each` : 'Bragging rights only';
    const parts = [];
    if (d.status === 'pending') {
      parts.push(text(`## ${ICON.duel} Faction Clash challenge\n<@${d.challenger_id}> challenges <@${d.opponent_id}>!\nStake: ${stake}\n-# Expires ${discordTime(d.expires_at, 'R')}. Each Commander secretly locks in a faction — 🔥 ▸ ☣️ ▸ ⚡ ▸ 🌑 ▸ 🔥, 🌌 is neutral.`));
      parts.push(row(
        button({ id: `duel:accept:${d.id}`, label: 'Accept', emoji: ICON.ok, style: ButtonStyle.Success }),
        button({ id: `duel:decline:${d.id}`, label: 'Decline / cancel', emoji: ICON.no, style: ButtonStyle.Danger }),
      ));
    } else if (d.status === 'active') {
      const locked = [d.challenger_pick ? `<@${d.challenger_id}> 🔒` : `<@${d.challenger_id}> …`, d.opponent_pick ? `<@${d.opponent_id}> 🔒` : `<@${d.opponent_id}> …`];
      parts.push(text(`## ${ICON.duel} Faction Clash — lock in!\nStake: ${stake} (escrowed)\n${locked.join('  vs  ')}\n-# Both Commanders press **Lock in** and choose secretly. Unfinished duels refund ${discordTime(d.expires_at, 'R')}.`));
      parts.push(row(button({ id: `duel:lock:${d.id}`, label: 'Lock in faction', emoji: '🔒', style: ButtonStyle.Primary })));
    } else {
      const a = FACTIONS[d.challenger_pick];
      const b = FACTIONS[d.opponent_pick];
      let headline;
      if (d.status === 'done') {
        headline = d.winner_id ? `🏆 <@${d.winner_id}> wins${d.stake ? ` ${currency.emoji} **${num(Math.floor(d.stake * 2 * (1 - this.bot.settings.get(d.guild_id).duels.taxPercent / 100)))}**` : ''}!` : '🤝 Draw — stakes returned.';
      } else headline = d.status === 'declined' ? 'Challenge declined.' : 'The duel expired — any stakes were refunded.';
      parts.push(text(`## ${ICON.duel} Faction Clash${d.status === 'done' ? ' — result' : ''}\n${a && b ? `<@${d.challenger_id}> ${a.emoji} **${a.name}**  vs  ${b.emoji} **${b.name}** <@${d.opponent_id}>\n` : ''}${headline}`));
    }
    return v2([container({ accent: d.status === 'done' && d.winner_id ? COLORS.gold : COLORS.danger }, ...parts)], { mentions: d.status === 'pending' ? [d.opponent_id] : [] });
  }

  async challenge(ctx, opponent, stake) {
    const guildId = ctx.guildId;
    const settings = this.bot.settings.get(guildId);
    const s = settings.duels;
    if (!s.enabled) throw new UserError('Duels are paused by the staff team.', { title: 'Duels paused', tone: 'warning' });
    if (!opponent || opponent.id === ctx.userId) throw new UserError('Pick another Commander to challenge.', { title: 'Invalid opponent', tone: 'warning' });
    if (opponent.user?.bot) throw new UserError('Bots do not duel.', { title: 'Invalid opponent', tone: 'warning' });
    if (stake < 0 || stake > s.maxStake) throw new UserError(`Stakes must be between 0 and ${num(s.maxStake)}.`, { title: 'Invalid stake', tone: 'warning' });
    const today = dayKey(Date.now(), settings.general.resetHour);
    const mine = this.bot.members.day(this.bot.members.ensure(guildId, ctx.userId), today);
    if (mine.day_duels >= s.dailyLimit) throw new UserError(`You have reached today's limit of ${s.dailyLimit} duels.`, { title: 'Daily limit', tone: 'warning' });
    if (stake && this.bot.economy.balance(guildId, ctx.userId) < stake) throw new UserError(`You don't have ${num(stake)} ${this.bot.settings.currency(guildId).name} to stake.`, { title: 'Not enough shards', tone: 'warning' });
    const busy = this.bot.db.get("SELECT 1 FROM duels WHERE guild_id = ? AND status IN ('pending','active') AND (challenger_id IN (?, ?) OR opponent_id IN (?, ?))", guildId, ctx.userId, opponent.id, ctx.userId, opponent.id);
    if (busy) throw new UserError('One of you is already in a pending duel.', { title: 'Duel in progress', tone: 'warning' });
    const now = Date.now();
    const res = this.bot.db.run('INSERT INTO duels (guild_id, channel_id, challenger_id, opponent_id, stake, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, \'pending\', ?, ?)', guildId, ctx.channelId, ctx.userId, opponent.id, stake, now, now + PENDING_MS);
    const d = this.get(Number(res.lastInsertRowid));
    this.bot.scheduler.schedule(`duel:${d.id}`, 'duel.expire', d.expires_at, { id: d.id });
    return d;
  }

  accept(d, userId) {
    if (d.status !== 'pending' || Date.now() > d.expires_at) throw new UserError('This challenge is no longer open.', { title: 'Expired', tone: 'warning' });
    if (userId !== d.opponent_id) throw new UserError('Only the challenged Commander can accept.', { title: 'Not your duel', tone: 'warning' });
    const settings = this.bot.settings.get(d.guild_id);
    const today = dayKey(Date.now(), settings.general.resetHour);
    if (d.stake) {
      const name = this.bot.settings.currency(d.guild_id).name;
      if (this.bot.economy.balance(d.guild_id, d.challenger_id) < d.stake) throw new UserError(`The challenger no longer has ${num(d.stake)} ${name} for this stake.`, { title: 'Stake unavailable', tone: 'warning' });
      if (this.bot.economy.balance(d.guild_id, d.opponent_id) < d.stake) throw new UserError(`You need ${num(d.stake)} ${name} to accept this duel.`, { title: 'Not enough shards', tone: 'warning' });
    }
    this.bot.db.tx(() => {
      if (d.stake) {
        this.bot.economy.debit(d.guild_id, d.challenger_id, d.stake, 'duel', { reason: `Duel #${d.id} stake`, ref: d.id });
        this.bot.economy.debit(d.guild_id, d.opponent_id, d.stake, 'duel', { reason: `Duel #${d.id} stake`, ref: d.id });
      }
      this.bot.members.bumpDay(d.guild_id, d.challenger_id, today, { day_duels: 1 });
      this.bot.members.bumpDay(d.guild_id, d.opponent_id, today, { day_duels: 1 });
      this.bot.db.run("UPDATE duels SET status = 'active', expires_at = ? WHERE id = ?", Date.now() + ACTIVE_MS, d.id);
    });
    const updated = this.get(d.id);
    this.bot.scheduler.schedule(`duel:${d.id}`, 'duel.expire', updated.expires_at, { id: d.id });
    return updated;
  }

  pick(d, userId, faction) {
    if (d.status !== 'active') throw new UserError('This duel is not waiting for picks.', { title: 'Too late', tone: 'warning' });
    if (!FACTIONS[faction]) throw new UserError('Unknown faction.');
    const col = userId === d.challenger_id ? 'challenger_pick' : userId === d.opponent_id ? 'opponent_pick' : null;
    if (!col) throw new UserError('You are not part of this duel.', { title: 'Not your duel', tone: 'warning' });
    if (d[col]) throw new UserError('You already locked in.', { title: 'Locked', tone: 'warning' });
    this.bot.db.run(`UPDATE duels SET ${col} = ? WHERE id = ?`, faction, d.id);
    return this.get(d.id);
  }

  /** Settle a duel once both picks are in. */
  settle(d) {
    if (d.status !== 'active' || !d.challenger_pick || !d.opponent_pick) return d;
    const outcome = resolveDuel(d.challenger_pick, d.opponent_pick);
    const winner = outcome === 'challenger' ? d.challenger_id : outcome === 'opponent' ? d.opponent_id : null;
    const tax = this.bot.settings.get(d.guild_id).duels.taxPercent;
    this.bot.db.tx(() => {
      if (d.stake) {
        if (winner) this.bot.economy.credit(d.guild_id, winner, Math.floor(d.stake * 2 * (1 - tax / 100)), 'duel', { reason: `Won duel #${d.id}`, ref: d.id });
        else {
          this.bot.economy.credit(d.guild_id, d.challenger_id, d.stake, 'duel_refund', { reason: `Duel #${d.id} draw`, ref: d.id });
          this.bot.economy.credit(d.guild_id, d.opponent_id, d.stake, 'duel_refund', { reason: `Duel #${d.id} draw`, ref: d.id });
        }
      }
      this.bot.db.run("UPDATE duels SET status = 'done', winner_id = ? WHERE id = ?", winner, d.id);
    });
    this.bot.scheduler.cancel(`duel:${d.id}`);
    if (winner) {
      this.bot.members.bumpStat(d.guild_id, winner, 'duel_wins');
      this.bot.activity({ type: 'duel_win', guildId: d.guild_id, userId: winner });
    }
    return this.get(d.id);
  }

  async expire(id) {
    const d = this.get(id);
    if (!d || !['pending', 'active'].includes(d.status)) return;
    this.bot.db.tx(() => {
      if (d.status === 'active' && d.stake) {
        this.bot.economy.credit(d.guild_id, d.challenger_id, d.stake, 'duel_refund', { reason: `Duel #${d.id} expired`, ref: d.id });
        this.bot.economy.credit(d.guild_id, d.opponent_id, d.stake, 'duel_refund', { reason: `Duel #${d.id} expired`, ref: d.id });
      }
      this.bot.db.run("UPDATE duels SET status = 'expired' WHERE id = ?", d.id);
    });
    const updated = this.get(d.id);
    if (updated.message_id) await this.bot.api.edit(updated.channel_id, updated.message_id, this.render(updated)).catch(() => null);
  }
}

export default function setup(bot) {
  const duels = new Duels(bot);
  bot.services.duels = duels;
  bot.scheduler.register('duel.expire', ({ id }) => duels.expire(id));

  bot.router.command({
    name: 'duel',
    description: 'Challenge a Commander to a Faction Clash — counter their faction to win.',
    defer: 'public',
    options: [
      { type: OptionType.User, name: 'opponent', description: 'Who to challenge', required: true },
      { type: OptionType.Integer, name: 'stake', description: 'Core Shards each side puts in (0 for bragging rights)', min_value: 0, max_value: 100_000 },
    ],
    async run(ctx) {
      requireGuild(ctx);
      const d = await duels.challenge(ctx, ctx.optionUser('opponent'), ctx.option('stake', 0));
      await ctx.reply(duels.render(d));
      const original = await bot.rest.get(`/webhooks/${ctx.raw.application_id}/${ctx.token}/messages/@original`).catch(() => null);
      if (original?.id) bot.db.run('UPDATE duels SET message_id = ? WHERE id = ?', original.id, d.id);
    },
  });

  bot.router.component('duel', async (ctx, action, id, faction) => {
    requireGuild(ctx);
    let d = duels.get(id);
    if (!d) throw new UserError('That duel no longer exists.', { title: 'Gone', tone: 'warning' });
    if (!d.message_id && ctx.message?.id) {
      bot.db.run('UPDATE duels SET message_id = ? WHERE id = ?', ctx.message.id, d.id);
      d = duels.get(id);
    }
    if (action === 'accept') {
      d = duels.accept(d, ctx.userId);
      return ctx.update(duels.render(d));
    }
    if (action === 'decline') {
      if (![d.challenger_id, d.opponent_id].includes(ctx.userId)) throw new UserError('Only the duelists can cancel this challenge.', { title: 'Not your duel', tone: 'warning' });
      if (d.status !== 'pending') throw new UserError('This duel can no longer be declined.', { title: 'Too late', tone: 'warning' });
      bot.db.run("UPDATE duels SET status = 'declined' WHERE id = ?", d.id);
      bot.scheduler.cancel(`duel:${d.id}`);
      return ctx.update(duels.render(duels.get(d.id)));
    }
    if (action === 'lock') {
      if (![d.challenger_id, d.opponent_id].includes(ctx.userId)) throw new UserError('Only the duelists can lock in.', { title: 'Not your duel', tone: 'warning' });
      return ctx.reply(v2([container({ accent: COLORS.danger },
        text('### 🔒 Choose your faction\nYour pick stays secret until both Commanders are locked in.'),
        separator(),
        row(...FACTION_KEYS.map((k) => button({ id: `duel:pick:${d.id}:${k}`, label: FACTIONS[k].name, emoji: FACTIONS[k].emoji }))),
      )], { ephemeral: true }));
    }
    if (action === 'pick') {
      d = duels.pick(d, ctx.userId, faction);
      await ctx.update(v2([container({ accent: FACTIONS[faction].color }, text(`### ${FACTIONS[faction].emoji} Locked in: ${FACTIONS[faction].name}\nWaiting for your opponent…`))], { ephemeral: true }));
      d = duels.settle(d);
      if (d.message_id) await bot.api.edit(d.channel_id, d.message_id, duels.render(d)).catch(() => null);
    }
    return undefined;
  });
}
