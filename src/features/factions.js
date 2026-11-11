// Factions: pledge to one of the five in-game factions, earn weekly faction points from XP
// (capped per member so large factions can't simply out-number small ones), weekly results.
import { UserError } from '../core/interactions.js';
import { button, container, row, separator, text, v2, ButtonStyle } from '../core/components.js';
import { canAssignRole, canPost } from '../core/permissions.js';
import { COLORS, FACTIONS, FACTION_KEYS, ICON } from '../content/theme.js';
import { discordTime, nextWeekReset, weekKey, DAY } from '../util/time.js';
import { bar, num } from '../util/format.js';
import { requireGuild } from './common.js';
import { banner } from '../ui.js';

export class Factions {
  constructor(bot) {
    this.bot = bot;
  }

  week(guildId, now = Date.now()) {
    return weekKey(now, this.bot.settings.get(guildId).general.resetHour);
  }

  onActivity(evt) {
    if (evt.type !== 'xp' || !evt.amount) return;
    const settings = this.bot.settings.get(evt.guildId);
    if (!settings.factions.enabled) return;
    const rec = this.bot.members.get(evt.guildId, evt.userId);
    if (!rec?.faction) return;
    const wk = this.week(evt.guildId);
    const cur = this.bot.db.get('SELECT points FROM faction_points WHERE guild_id = ? AND week_key = ? AND user_id = ?', evt.guildId, wk, evt.userId)?.points ?? 0;
    const add = Math.max(0, Math.min(evt.amount, settings.factions.contributionCap - cur));
    if (!add) return;
    this.bot.db.run(
      `INSERT INTO faction_points (guild_id, week_key, user_id, faction, points) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, week_key, user_id) DO UPDATE SET points = points + excluded.points, faction = excluded.faction`,
      evt.guildId, wk, evt.userId, rec.faction, add,
    );
  }

  standings(guildId, wk = this.week(guildId)) {
    const rows = this.bot.db.all('SELECT faction, SUM(points) AS points, COUNT(*) AS members FROM faction_points WHERE guild_id = ? AND week_key = ? GROUP BY faction', guildId, wk);
    const byKey = new Map(rows.map((r) => [r.faction, r]));
    return FACTION_KEYS.map((k) => ({ faction: k, points: byKey.get(k)?.points || 0, members: byKey.get(k)?.members || 0 })).sort((a, b) => b.points - a.points);
  }

  roster(guildId) {
    const rows = this.bot.db.all('SELECT faction, COUNT(*) AS n FROM members WHERE guild_id = ? AND left_guild = 0 AND faction IS NOT NULL GROUP BY faction', guildId);
    return Object.fromEntries(rows.map((r) => [r.faction, r.n]));
  }

  async pledge(guildId, userId, faction, memberRoles = []) {
    if (!FACTIONS[faction]) throw new UserError('Unknown faction.', { title: 'Invalid choice' });
    const settings = this.bot.settings.get(guildId);
    const rec = this.bot.members.ensure(guildId, userId);
    if (rec.faction === faction) throw new UserError(`You already fight for ${FACTIONS[faction].emoji} **${FACTIONS[faction].name}**.`, { title: 'Already pledged', tone: 'warning' });
    if (rec.faction && rec.faction_since && Date.now() - rec.faction_since < settings.factions.switchCooldownDays * DAY) {
      throw new UserError(`You can switch factions again ${discordTime(rec.faction_since + settings.factions.switchCooldownDays * DAY, 'R')}.`, { title: 'Switch on cooldown', tone: 'warning' });
    }
    this.bot.db.tx(() => {
      this.bot.members.update(guildId, userId, { faction, faction_since: Date.now() });
      // Switching forfeits this week's contribution to the old faction.
      this.bot.db.run('DELETE FROM faction_points WHERE guild_id = ? AND week_key = ? AND user_id = ?', guildId, this.week(guildId), userId);
    });
    const roleIds = settings.factions.roleIds || {};
    for (const [key, roleId] of Object.entries(roleIds)) {
      if (!roleId || !canAssignRole(this.bot.cache, guildId, roleId).ok) continue;
      if (key === faction && !memberRoles.includes(roleId)) await this.bot.api.addRole(guildId, userId, roleId, `Pledged to ${FACTIONS[key].name}`).catch(() => null);
      if (key !== faction && memberRoles.includes(roleId)) await this.bot.api.removeRole(guildId, userId, roleId, 'Faction switch').catch(() => null);
    }
    return rec.faction;
  }

  /** Close a week: reward the winning faction's active contributors and announce. Idempotent. */
  async finalizeWeek(guildId, wk) {
    if (this.bot.db.get('SELECT 1 FROM faction_results WHERE guild_id = ? AND week_key = ?', guildId, wk)) return null;
    const settings = this.bot.settings.get(guildId);
    const standings = this.standings(guildId, wk);
    const top = standings[0];
    const winners = top && top.points > 0 ? standings.filter((s) => s.points === top.points).map((s) => s.faction) : [];
    let rewarded = 0;
    this.bot.db.tx(() => {
      if (settings.factions.enabled && winners.length && settings.factions.weeklyReward > 0) {
        const eligible = this.bot.db.all(`SELECT user_id FROM faction_points WHERE guild_id = ? AND week_key = ? AND points >= ? AND faction IN (${winners.map(() => '?').join(',')})`, guildId, wk, settings.factions.minContribution, ...winners);
        for (const e of eligible) {
          this.bot.economy.credit(guildId, e.user_id, settings.factions.weeklyReward, 'faction', { reason: `Faction victory (week ${wk})` });
          rewarded += 1;
        }
      }
      this.bot.db.run('INSERT OR IGNORE INTO faction_results (guild_id, week_key, winner, standings, created_at) VALUES (?, ?, ?, ?, ?)', guildId, wk, winners.join(',') || null, JSON.stringify(standings), Date.now());
      this.bot.db.run('DELETE FROM faction_points WHERE guild_id = ? AND week_key < ?', guildId, wk - 8);
    });
    const channelId = settings.events.channelId;
    if (settings.factions.enabled && winners.length && channelId && canPost(this.bot.cache, guildId, channelId).ok) {
      const currency = this.bot.settings.currency(guildId);
      const total = standings.reduce((a, s) => a + s.points, 0) || 1;
      const lines = standings.map((s, i) => `${i === 0 ? '👑' : '▫️'} ${FACTIONS[s.faction].emoji} **${FACTIONS[s.faction].name}** — ${num(s.points)} pts · ${s.members} Commanders`);
      const winText = winners.map((w) => `${FACTIONS[w].emoji} **${FACTIONS[w].name}**`).join(' & ');
      await this.bot.api.send(channelId, v2([container({ accent: FACTIONS[winners[0]].color },
        text(`## ${ICON.faction} Faction Clash results\n${winText} ${winners.length > 1 ? 'share' : 'takes'} the week with ${Math.round((top.points / total) * 100)}% of all faction points!`),
        separator(),
        text(lines.join('\n')),
        text(`-# ${rewarded} active Commander${rewarded === 1 ? '' : 's'} of the winning faction received ${currency.emoji} ${settings.factions.weeklyReward}. A new week begins now — pledge with \`/faction\`.`),
      )])).catch((err) => this.bot.log.warn(`faction results post failed: ${err.message}`));
    }
    return { winners, rewarded };
  }

  render(guildId, userId, { note } = {}) {
    const settings = this.bot.settings.get(guildId);
    const rec = this.bot.members.ensure(guildId, userId);
    const wk = this.week(guildId);
    const standings = this.standings(guildId, wk);
    const roster = this.roster(guildId);
    const max = Math.max(1, ...standings.map((s) => s.points));
    const mine = FACTIONS[rec.faction];
    const myPoints = this.bot.db.get('SELECT points FROM faction_points WHERE guild_id = ? AND week_key = ? AND user_id = ?', guildId, wk, userId)?.points ?? 0;
    const last = this.bot.db.get('SELECT * FROM faction_results WHERE guild_id = ? ORDER BY week_key DESC LIMIT 1', guildId);
    const currency = this.bot.settings.currency(guildId);

    const parts = [banner(settings), text(`## ${ICON.faction} Faction Clash\n-# Week ends ${discordTime(nextWeekReset(Date.now(), settings.general.resetHour), 'R')} · 🔥 ▸ ☣️ ▸ ⚡ ▸ 🌑 ▸ 🔥 · 🌌 neutral`)];
    if (!settings.factions.enabled) parts.push(text('-# ⚠️ The Faction Clash is paused by the staff team.'));
    if (note) parts.push(text(note));
    if (mine) {
      const weak = FACTION_KEYS.find((k) => FACTIONS[k].beats === rec.faction);
      parts.push(text([
        `### ${mine.emoji} ${mine.name} — *${mine.motto}*`,
        `Your contribution this week: **${num(myPoints)}** / ${num(settings.factions.contributionCap)} pts${myPoints >= settings.factions.minContribution ? ' ✅ eligible for the victory reward' : ` · ${num(settings.factions.minContribution)} pts makes you eligible for the ${currency.emoji} ${settings.factions.weeklyReward} victory reward`}`,
        `-# ${mine.beats ? `Counters ${FACTIONS[mine.beats].emoji} ${FACTIONS[mine.beats].name}` : 'No counters'} · ${weak ? `weak to ${FACTIONS[weak].emoji} ${FACTIONS[weak].name}` : 'no weaknesses'} · pledged ${discordTime(rec.faction_since, 'R')}`,
      ].join('\n')));
    } else {
      parts.push(text(`### Choose your faction\nPledging is free. Your XP earns faction points every week (up to ${num(settings.factions.contributionCap)} per Commander) and the winning faction's active members share the spoils. Faction choice also matters in Calamity Breaches, expeditions and duels.`));
    }
    parts.push(separator());
    parts.push(text(standings.map((s, i) => {
      const f = FACTIONS[s.faction];
      return `${i === 0 && s.points > 0 ? '👑' : f.emoji} **${f.name}** \`${bar(s.points, max, 8)}\` ${num(s.points)} pts · ${roster[s.faction] || 0} pledged`;
    }).join('\n')));
    if (mine) {
      const topMine = this.bot.db.all('SELECT user_id, points FROM faction_points WHERE guild_id = ? AND week_key = ? AND faction = ? ORDER BY points DESC LIMIT 5', guildId, wk, rec.faction);
      if (topMine.length) parts.push(text(`-# Top ${mine.name} contributors: ${topMine.map((t, i) => `${i + 1}. <@${t.user_id}> (${num(t.points)})`).join(' · ')}`));
    }
    if (last?.winner) parts.push(text(`-# Last week: ${last.winner.split(',').map((w) => `${FACTIONS[w].emoji} ${FACTIONS[w].name}`).join(' & ')} won.`));
    const canSwitch = !rec.faction || !rec.faction_since || Date.now() - rec.faction_since >= settings.factions.switchCooldownDays * DAY;
    parts.push(row(...FACTION_KEYS.map((k) => button({
      id: `fac:${rec.faction ? 'switch' : 'pledge'}:${k}`,
      label: FACTIONS[k].name,
      emoji: FACTIONS[k].emoji,
      style: rec.faction === k ? ButtonStyle.Success : ButtonStyle.Secondary,
      disabled: rec.faction === k || !canSwitch || !settings.factions.enabled,
    }))));
    if (rec.faction && !canSwitch) parts.push(text(`-# You can switch factions ${discordTime(rec.faction_since + settings.factions.switchCooldownDays * DAY, 'R')}. Switching forfeits the current week's contribution.`));
    return v2([container({ accent: mine?.color ?? COLORS.primary }, ...parts)], { ephemeral: true });
  }
}

export default function setup(bot) {
  const factions = new Factions(bot);
  bot.services.factions = factions;
  bot.onActivity((evt) => factions.onActivity(evt));

  bot.router.command({
    name: 'faction',
    description: 'Pledge to a faction and follow the weekly Faction Clash standings.',
    async run(ctx) {
      await ctx.reply(factions.render(requireGuild(ctx), ctx.userId));
    },
  });

  bot.router.component('fac', async (ctx, action, key, confirm) => {
    const guildId = requireGuild(ctx);
    if (action !== 'view' && !bot.settings.get(guildId).factions.enabled) throw new UserError('The Faction Clash is currently paused.', { title: 'Factions paused', tone: 'warning' });
    const f = FACTIONS[key];
    if (action === 'view' || !f) {
      await ctx.update(factions.render(guildId, ctx.userId));
      return;
    }
    if (action === 'switch' && confirm !== 'yes') {
      await ctx.update(v2([container({ accent: f.color },
        text(`### ${f.emoji} Switch to ${f.name}?\nYou will lose this week's contribution to your current faction and can't switch again for ${bot.settings.get(guildId).factions.switchCooldownDays} days.`),
        row(button({ id: `fac:switch:${key}:yes`, label: `Join ${f.name}`, emoji: f.emoji, style: ButtonStyle.Danger }), button({ id: 'fac:view:none', label: 'Keep my faction', emoji: ICON.back })),
      )], { ephemeral: true }));
      return;
    }
    await factions.pledge(guildId, ctx.userId, key, ctx.memberRoles);
    await ctx.update(factions.render(guildId, ctx.userId, { note: `> ${f.emoji} You now fight for **${f.name}** — *${f.motto}*` }));
  });
}
