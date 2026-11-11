// Period rollovers: weekly (faction results + weekly ladder) and monthly seasons (prizes + reset).
// A minute ticker compares stored period keys, so missed rollovers run as soon as the bot is back.
import { container, separator, text, v2 } from '../core/components.js';
import { canPost } from '../core/permissions.js';
import { COLORS, ICON } from '../content/theme.js';
import { monthKey, nextMonthReset, weekKey, DAY } from '../util/time.js';
import { num } from '../util/format.js';

export class Seasons {
  constructor(bot) {
    this.bot = bot;
    this.running = false;
  }

  async tick(now = Date.now()) {
    if (this.running) return;
    this.running = true;
    try {
      for (const guild of this.bot.cache.guilds.values()) {
        if (guild.unavailable) continue;
        await this.rollover(guild.id, now).catch((err) => this.bot.log.error(`rollover failed for ${guild.id}`, err));
      }
    } finally {
      this.running = false;
    }
  }

  async rollover(guildId, now = Date.now()) {
    const settings = this.bot.settings.get(guildId);
    const h = settings.general.resetHour;
    const state = this.bot.state.get(guildId);
    const wk = weekKey(now, h);
    const mk = monthKey(now, h);
    if (state.week_key === null || state.week_key === undefined) this.bot.state.update(guildId, { week_key: wk });
    else if (state.week_key !== wk) {
      await this.bot.services.factions.finalizeWeek(guildId, state.week_key);
      this.bot.db.run('UPDATE members SET weekly_xp = 0 WHERE guild_id = ?', guildId);
      this.bot.state.update(guildId, { week_key: wk });
      this.bot.log.info(`[${guildId}] weekly rollover → week ${wk}`);
    }
    if (!state.season_key) this.bot.state.update(guildId, { season_key: mk, season_started_at: state.season_started_at || now });
    else if (state.season_key !== mk) await this.endSeason(guildId, { now });
  }

  /** Close the current season: reward the ladder, archive results, reset season XP. */
  async endSeason(guildId, { now = Date.now(), by = null } = {}) {
    const settings = this.bot.settings.get(guildId);
    const state = this.bot.state.get(guildId);
    const top = this.bot.members.top(guildId, 'season_xp', 10);
    const rewards = settings.seasons.enabled ? settings.seasons.rewards : [];
    const results = top.map((m, i) => ({ userId: m.user_id, xp: m.season_xp, reward: rewards[i] || 0 }));
    this.bot.db.tx(() => {
      for (const [i, r] of results.entries()) {
        if (r.reward > 0) this.bot.economy.credit(guildId, r.userId, r.reward, 'season', { reason: `Season ${state.season_no} — #${i + 1}` });
      }
      this.bot.db.run('INSERT OR REPLACE INTO seasons (guild_id, season_no, season_key, started_at, ended_at, results) VALUES (?, ?, ?, ?, ?, ?)', guildId, state.season_no, state.season_key, state.season_started_at, now, JSON.stringify(results));
      this.bot.db.run('UPDATE members SET season_xp = 0 WHERE guild_id = ?', guildId);
      this.bot.state.update(guildId, { season_no: state.season_no + 1, season_key: monthKey(now, settings.general.resetHour), season_started_at: now });
      // Housekeeping for finished events and duels.
      this.bot.db.run("DELETE FROM event_participants WHERE event_id IN (SELECT id FROM events WHERE guild_id = ? AND status != 'active' AND created_at < ?)", guildId, now - 30 * DAY);
      this.bot.db.run("DELETE FROM events WHERE guild_id = ? AND status != 'active' AND created_at < ?", guildId, now - 30 * DAY);
      this.bot.db.run("DELETE FROM duels WHERE guild_id = ? AND status NOT IN ('pending','active') AND created_at < ?", guildId, now - 30 * DAY);
    });
    for (const r of results.slice(0, 3)) this.bot.members.bumpStat(guildId, r.userId, 'season_top3');
    this.bot.log.info(`[${guildId}] season ${state.season_no} closed (${results.length} ranked)`);
    await this.bot.services.audit.log(guildId, { title: `${ICON.season} Season ${state.season_no} closed`, actorId: by, color: COLORS.gold, fields: results.slice(0, 3).map((r, i) => ({ name: `#${i + 1}`, value: `<@${r.userId}> · ${num(r.xp)} XP` })) });

    const channelId = settings.events.channelId || settings.leveling.announceChannelId;
    if (settings.seasons.enabled && results.length && channelId && canPost(this.bot.cache, guildId, channelId).ok) {
      const currency = this.bot.settings.currency(guildId);
      const podium = results.map((r, i) => `${['🥇', '🥈', '🥉'][i] || `**#${i + 1}**`} <@${r.userId}> — ${num(r.xp)} XP${r.reward ? ` · +${currency.emoji} ${num(r.reward)}` : ''}`).join('\n');
      await this.bot.api.send(channelId, v2([container({ accent: COLORS.gold },
        text(`## ${ICON.season} Season ${state.season_no} — final standings\nThe Sanctuary Core has sealed the season ledger. Congratulations, Commanders!`),
        separator(),
        text(podium),
        text(`-# Season ${state.season_no + 1} starts now and ends ${`<t:${Math.floor(nextMonthReset(now, settings.general.resetHour) / 1000)}:R>`}. Season XP was reset; lifetime levels are untouched.`),
      )], { mentions: results.slice(0, 3).map((r) => r.userId) })).catch((err) => this.bot.log.warn(`season post failed: ${err.message}`));
    }
    return results;
  }
}

export default function setup(bot) {
  const seasons = new Seasons(bot);
  bot.services.seasons = seasons;
  bot.scheduler.every('rollover', 60_000, () => seasons.tick());
  // Run once shortly after start so missed rollovers are applied promptly.
  setTimeout(() => seasons.tick().catch(() => null), 20_000).unref?.();
}
