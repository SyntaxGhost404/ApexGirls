// Directives — daily and weekly quests assigned per Commander, advanced by real activity.
import { button, container, row, section, separator, text, v2, ButtonStyle } from '../core/components.js';
import { COLORS, ICON } from '../content/theme.js';
import { QUEST_POOL } from '../content/defaults.js';
import { seeded, seededSample } from '../util/random.js';
import { dayKey, discordTime, nextDayReset, nextWeekReset, weekKey } from '../util/time.js';
import { requireGuild } from './common.js';

const DEFS = {
  daily: new Map(QUEST_POOL.daily.map((q) => [q.key, q])),
  weekly: new Map(QUEST_POOL.weekly.map((q) => [q.key, q])),
};

export class Quests {
  constructor(bot) {
    this.bot = bot;
  }

  keys(settings, now = Date.now()) {
    const h = settings.general.resetHour;
    return { daily: dayKey(now, h), weekly: weekKey(now, h) };
  }

  moduleEnabled(settings, mod) {
    switch (mod) {
      case 'voice': return settings.voice.enabled;
      case 'expeditions': return settings.expeditions.enabled;
      case 'duels': return settings.duels.enabled;
      case 'events': return Boolean(settings.events.channelId);
      default: return true;
    }
  }

  /** Assign (deterministically) the directives for a period if not assigned yet. */
  ensure(guildId, userId, period, key, settings) {
    const sql = 'SELECT * FROM quests WHERE guild_id = ? AND user_id = ? AND period = ? AND period_key = ? ORDER BY slot';
    let rows = this.bot.db.all(sql, guildId, userId, period, key);
    if (rows.length) return rows;
    this.autoClaimStale(guildId, userId, period, key);
    const pool = QUEST_POOL[period].filter((q) => !q.requires || this.moduleEnabled(settings, q.requires));
    const count = Math.min(period === 'daily' ? settings.quests.dailyCount : settings.quests.weeklyCount, pool.length);
    const rng = seeded(`${guildId}:${userId}:${period}:${key}`);
    const chosen = seededSample(pool, count, rng);
    this.bot.db.tx(() => {
      chosen.forEach((q, slot) => {
        const target = q.targets[Math.floor(rng() * q.targets.length)];
        const reward = q.reward(target);
        this.bot.db.run(
          'INSERT OR IGNORE INTO quests (guild_id, user_id, period, period_key, slot, quest_key, target, progress, reward_shards, reward_xp) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
          guildId, userId, period, key, slot, q.key, target, Math.round(reward.shards), Math.round(reward.xp),
        );
      });
    });
    rows = this.bot.db.all(sql, guildId, userId, period, key);
    return rows;
  }

  /** Completed-but-unclaimed directives from past periods are credited automatically. */
  autoClaimStale(guildId, userId, period, key) {
    const stale = this.bot.db.all('SELECT * FROM quests WHERE guild_id = ? AND user_id = ? AND period = ? AND period_key < ? AND completed_at IS NOT NULL AND claimed_at IS NULL', guildId, userId, period, key);
    let shards = 0;
    let xp = 0;
    if (stale.length) {
      this.bot.db.tx(() => {
        for (const q of stale) {
          this.bot.db.run('UPDATE quests SET claimed_at = ? WHERE guild_id = ? AND user_id = ? AND period = ? AND period_key = ? AND slot = ?', Date.now(), guildId, userId, period, q.period_key, q.slot);
          shards += q.reward_shards;
          xp += q.reward_xp;
        }
        if (shards) this.bot.economy.credit(guildId, userId, shards, 'quest', { reason: `Auto-claimed ${stale.length} ${period} directive(s)` });
      });
      if (xp) this.bot.services.leveling.addXp(guildId, userId, xp, { source: 'quest' });
    }
    const keep = period === 'daily' ? key - 14 : key - 8;
    this.bot.db.run('DELETE FROM quests WHERE guild_id = ? AND user_id = ? AND period = ? AND period_key < ?', guildId, userId, period, keep);
    return { shards, xp, count: stale.length };
  }

  onActivity(evt) {
    if (!evt.guildId || !evt.userId) return;
    const settings = this.bot.settings.get(evt.guildId);
    if (!settings.quests.enabled) return;
    const keys = this.keys(settings);
    for (const period of ['daily', 'weekly']) {
      const rows = this.ensure(evt.guildId, evt.userId, period, keys[period], settings);
      for (const r of rows) {
        if (r.completed_at) continue;
        const def = DEFS[period].get(r.quest_key);
        if (!def || def.event !== evt.type) continue;
        let progress = r.progress;
        let meta = r.meta;
        if (def.distinct) {
          const seen = new Set(JSON.parse(meta || '[]'));
          if (!evt.key || seen.has(evt.key)) continue;
          seen.add(evt.key);
          progress = seen.size;
          meta = JSON.stringify([...seen].slice(-Math.max(r.target, 1)));
        } else {
          progress = Math.min(r.target, progress + Math.max(1, Math.round(evt.amount || 1)));
        }
        const completed = progress >= r.target ? Date.now() : null;
        this.bot.db.run(
          'UPDATE quests SET progress = ?, meta = ?, completed_at = ? WHERE guild_id = ? AND user_id = ? AND period = ? AND period_key = ? AND slot = ?',
          Math.min(progress, r.target), meta, completed, evt.guildId, evt.userId, period, r.period_key, r.slot,
        );
      }
    }
  }

  claim(guildId, userId) {
    const settings = this.bot.settings.get(guildId);
    const keys = this.keys(settings);
    const result = this.bot.db.tx(() => {
      const open = this.bot.db.all(
        'SELECT * FROM quests WHERE guild_id = ? AND user_id = ? AND ((period = \'daily\' AND period_key = ?) OR (period = \'weekly\' AND period_key = ?)) AND completed_at IS NOT NULL AND claimed_at IS NULL',
        guildId, userId, keys.daily, keys.weekly,
      );
      if (!open.length) return { count: 0, shards: 0, xp: 0, bonus: 0 };
      const now = Date.now();
      let shards = 0;
      let xp = 0;
      for (const q of open) {
        this.bot.db.run('UPDATE quests SET claimed_at = ? WHERE guild_id = ? AND user_id = ? AND period = ? AND period_key = ? AND slot = ?', now, guildId, userId, q.period, q.period_key, q.slot);
        shards += q.reward_shards;
        xp += q.reward_xp;
      }
      let bonus = 0;
      if (open.some((q) => q.period === 'daily')) {
        const daily = this.bot.db.all('SELECT claimed_at FROM quests WHERE guild_id = ? AND user_id = ? AND period = \'daily\' AND period_key = ?', guildId, userId, keys.daily);
        if (daily.length && daily.every((q) => q.claimed_at)) bonus = settings.quests.allClearBonus;
      }
      this.bot.economy.credit(guildId, userId, shards + bonus, 'quest', { reason: `Claimed ${open.length} directive(s)${bonus ? ' + all-clear bonus' : ''}` });
      return { count: open.length, shards, xp, bonus };
    });
    if (result.xp) this.bot.services.leveling.addXp(guildId, userId, result.xp, { source: 'quest' });
    return result;
  }

  render(guildId, userId, { notice: note } = {}) {
    const settings = this.bot.settings.get(guildId);
    const currency = this.bot.settings.currency(guildId);
    const keys = this.keys(settings);
    const h = settings.general.resetHour;
    const parts = [text(`## ${ICON.quest} Directives\n-# Daily refresh ${discordTime(nextDayReset(Date.now(), h), 'R')} · weekly refresh ${discordTime(nextWeekReset(Date.now(), h), 'R')}`)];
    if (note) parts.push(text(note));
    let claimable = 0;
    for (const period of ['daily', 'weekly']) {
      const rows = this.ensure(guildId, userId, period, keys[period], settings);
      parts.push(separator());
      parts.push(text(`### ${period === 'daily' ? '☀️ Daily' : '📆 Weekly'}`));
      if (!rows.length) parts.push(text('-# No directives available.'));
      for (const r of rows) {
        const def = DEFS[period].get(r.quest_key);
        const done = Boolean(r.completed_at);
        const claimed = Boolean(r.claimed_at);
        if (done && !claimed) claimable += 1;
        const icon = claimed ? '✅' : done ? '🎁' : '🔲';
        const rewards = [`+${currency.emoji} ${r.reward_shards}`];
        if (r.reward_xp) rewards.push(`+${r.reward_xp} XP`);
        const line = `${icon} **${def ? def.text(r.target) : r.quest_key}**\n${this.bot.emojis.bar(r.progress, r.target, 6)} ${r.progress.toLocaleString('en-US')}/${r.target.toLocaleString('en-US')} · ${rewards.join(' · ')}`;
        const id = `${period[0]}${r.slot}`;
        const accessory = claimed
          ? button({ id: `quests:done:${id}`, label: 'Claimed', style: ButtonStyle.Secondary, disabled: true })
          : done
            ? button({ id: `quests:claim:${id}`, label: 'Claim', emoji: '🎁', style: ButtonStyle.Success })
            : button({ id: `quests:wait:${id}`, label: `${Math.floor((r.progress / r.target) * 100)}%`, style: ButtonStyle.Secondary, disabled: true });
        parts.push(section(line, accessory));
      }
    }
    parts.push(separator());
    parts.push(text(`-# Clear every daily directive for a bonus ${currency.emoji} ${settings.quests.allClearBonus}. Finished directives you forget to claim are credited automatically after the reset.`));
    parts.push(row(
      button({ id: 'quests:claim:all', label: claimable ? `Claim all (${claimable})` : 'Nothing to claim', emoji: '🎁', style: ButtonStyle.Success, disabled: !claimable }),
      button({ id: 'quests:refresh', label: 'Refresh', emoji: ICON.refresh }),
      button({ id: 'daily:claim', label: 'Supply Airdrop', emoji: ICON.airdrop }),
    ));
    return v2([container({ accent: COLORS.accent }, ...parts)], { ephemeral: true });
  }
}

export default function setup(bot) {
  const quests = new Quests(bot);
  bot.services.quests = quests;
  bot.onActivity((evt) => quests.onActivity(evt));

  bot.router.command({
    name: 'quests',
    description: 'Your daily and weekly Directives — complete them for Core Shards and XP.',
    async run(ctx) {
      const guildId = requireGuild(ctx);
      if (!bot.settings.get(guildId).quests.enabled) {
        await ctx.reply(quests.render(guildId, ctx.userId, { notice: '-# ⚠️ Directives are currently paused by the staff team.' }));
        return;
      }
      await ctx.reply(quests.render(guildId, ctx.userId));
    },
  });

  bot.router.component('quests', async (ctx, action) => {
    const guildId = requireGuild(ctx);
    if (action === 'claim') {
      const r = quests.claim(guildId, ctx.userId);
      const currency = bot.settings.currency(guildId);
      const note = r.count
        ? `> 🎁 Claimed **${r.count}** directive${r.count === 1 ? '' : 's'}: +${currency.emoji} **${(r.shards + r.bonus).toLocaleString('en-US')}**${r.xp ? ` · +${r.xp} XP` : ''}${r.bonus ? ` *(includes all-clear bonus)*` : ''}`
        : '> Nothing to claim yet.';
      const payload = quests.render(guildId, ctx.userId, { notice: note });
      if (ctx.message?.flags & 64) await ctx.update(payload);
      else await ctx.reply(payload);
      return;
    }
    const payload = quests.render(guildId, ctx.userId);
    // Ephemeral panels can be updated in place; buttons on public messages open a private copy.
    if (action === 'refresh' && ctx.message?.flags & 64) await ctx.update(payload);
    else await ctx.reply(payload);
  });
}
