// Wildness Expeditions: timed idle runs (1h / 4h / 8h) with a daily hazard faction, ambush risk,
// shard/XP salvage and collectible relics. Limited launches per day keep it a side activity.
import { UserError } from '../core/interactions.js';
import { button, container, row, separator, stringSelect, text, v2, ButtonStyle } from '../core/components.js';
import { COLORS, FACTIONS, FACTION_KEYS, ICON, matchup } from '../content/theme.js';
import { EXPEDITION_ROUTES, RELICS, RELIC_SALVAGE, RELIC_TIER_COLORS } from '../content/lore.js';
import { chance, randInt, seeded, weightedPick } from '../util/random.js';
import { dayKey, discordTime, nextDayReset, HOUR } from '../util/time.js';
import { bar, num } from '../util/format.js';
import { requireGuild } from './common.js';

export function hazardFor(guildId, day) {
  const rng = seeded(`hazard:${guildId}:${day}`);
  return FACTION_KEYS[Math.floor(rng() * FACTION_KEYS.length)];
}

/** Roll the loot for a finished expedition (pure function, exported for tests). */
export function rollLoot(route, faction, hazard) {
  const mu = matchup(faction, hazard);
  let shards = randInt(route.shards[0], route.shards[1]);
  let xp = randInt(route.xp[0], route.xp[1]);
  let ambushed = false;
  if (mu > 0) {
    shards = Math.round(shards * 1.25);
    xp = Math.round(xp * 1.1);
  } else if (route.ambush && chance(mu < 0 ? route.ambush * 1.5 : route.ambush)) {
    ambushed = true;
    shards = Math.round(shards * 0.7);
  }
  let relic = null;
  if (chance(route.relicChance * (mu > 0 ? 1.2 : 1))) {
    const tier = weightedPick(Object.keys(route.tiers), (t) => route.tiers[t]);
    const options = RELICS.filter((r) => r.tier === tier);
    relic = options[randInt(0, options.length - 1)];
  }
  return { shards, xp, ambushed, relic, advantage: mu > 0 };
}

export class Expeditions {
  constructor(bot) {
    this.bot = bot;
  }

  current(guildId, userId) {
    return this.bot.db.get('SELECT * FROM expeditions WHERE guild_id = ? AND user_id = ?', guildId, userId);
  }

  launch(guildId, userId, routeKey) {
    const settings = this.bot.settings.get(guildId);
    if (!settings.expeditions.enabled) throw new UserError('Expeditions are paused by the staff team.', { title: 'Paused', tone: 'warning' });
    const route = EXPEDITION_ROUTES[routeKey];
    if (!route) throw new UserError('Unknown route.');
    if (this.current(guildId, userId)) throw new UserError('Your squad is already out in the Wildness.', { title: 'Squad deployed', tone: 'warning' });
    const today = dayKey(Date.now(), settings.general.resetHour);
    const rec = this.bot.members.ensure(guildId, userId);
    const day = this.bot.members.day(rec, today);
    if (day.day_expeditions >= settings.expeditions.dailyLaunches) {
      throw new UserError(`You have used all ${settings.expeditions.dailyLaunches} expedition launches for today. New launches ${discordTime(nextDayReset(Date.now(), settings.general.resetHour), 'R')}.`, { title: 'Out of launches', tone: 'warning' });
    }
    const now = Date.now();
    this.bot.db.tx(() => {
      this.bot.db.run('INSERT INTO expeditions (guild_id, user_id, route, started_at, ends_at) VALUES (?, ?, ?, ?, ?)', guildId, userId, routeKey, now, now + route.hours * HOUR);
      this.bot.members.bumpDay(guildId, userId, today, { day_expeditions: 1 });
    });
  }

  claim(guildId, userId) {
    const exp = this.current(guildId, userId);
    if (!exp) throw new UserError('You have no expedition to claim.', { title: 'Nothing to claim', tone: 'warning' });
    if (Date.now() < exp.ends_at) throw new UserError(`Your squad returns ${discordTime(exp.ends_at, 'R')}.`, { title: 'Still out', tone: 'warning' });
    const settings = this.bot.settings.get(guildId);
    const route = EXPEDITION_ROUTES[exp.route];
    const rec = this.bot.members.ensure(guildId, userId);
    const hazard = hazardFor(guildId, dayKey(exp.started_at, settings.general.resetHour));
    const loot = rollLoot(route, rec.faction, hazard);
    this.bot.db.tx(() => {
      this.bot.db.run('DELETE FROM expeditions WHERE guild_id = ? AND user_id = ?', guildId, userId);
      this.bot.economy.credit(guildId, userId, loot.shards, 'expedition', { reason: route.name });
      if (loot.relic) {
        this.bot.db.run(
          `INSERT INTO inventory (guild_id, user_id, item_key, quantity, data, acquired_at) VALUES (?, ?, ?, 1, ?, ?)
           ON CONFLICT(guild_id, user_id, item_key) DO UPDATE SET quantity = quantity + 1`,
          guildId, userId, `relic:${loot.relic.key}`, JSON.stringify({ name: loot.relic.name, tier: loot.relic.tier, emoji: loot.relic.emoji }), Date.now(),
        );
      }
    });
    this.bot.services.leveling.addXp(guildId, userId, loot.xp, { source: 'expedition' });
    this.bot.members.bumpStat(guildId, userId, 'expeditions');
    this.bot.activity({ type: 'expedition', guildId, userId });
    return { ...loot, route, hazard };
  }

  relics(guildId, userId) {
    const rows = this.bot.db.all("SELECT item_key, quantity FROM inventory WHERE guild_id = ? AND user_id = ? AND item_key LIKE 'relic:%'", guildId, userId);
    return new Map(rows.map((r) => [r.item_key.slice(6), r.quantity]));
  }

  salvageDuplicates(guildId, userId) {
    const owned = this.relics(guildId, userId);
    let total = 0;
    let count = 0;
    this.bot.db.tx(() => {
      for (const relic of RELICS) {
        const qty = owned.get(relic.key) || 0;
        if (qty > 1) {
          const extra = qty - 1;
          total += extra * RELIC_SALVAGE[relic.tier];
          count += extra;
          this.bot.db.run('UPDATE inventory SET quantity = 1 WHERE guild_id = ? AND user_id = ? AND item_key = ?', guildId, userId, `relic:${relic.key}`);
        }
      }
      if (total) this.bot.economy.credit(guildId, userId, total, 'salvage', { reason: `Salvaged ${count} duplicate relic(s)` });
    });
    return { total, count };
  }

  render(guildId, userId, { note } = {}) {
    const settings = this.bot.settings.get(guildId);
    const currency = this.bot.settings.currency(guildId);
    const rec = this.bot.members.ensure(guildId, userId);
    const today = dayKey(Date.now(), settings.general.resetHour);
    const hazard = hazardFor(guildId, today);
    const hz = FACTIONS[hazard];
    const counter = FACTION_KEYS.find((k) => FACTIONS[k].beats === hazard);
    const day = this.bot.members.day(rec, today);
    const left = Math.max(0, settings.expeditions.dailyLaunches - day.day_expeditions);
    const exp = this.current(guildId, userId);
    const parts = [text(`## ${ICON.expedition} Wildness Expeditions\n-# Send your squad beyond the walls for salvage, XP and relics · ${left}/${settings.expeditions.dailyLaunches} launches left today`)];
    if (!settings.expeditions.enabled) parts.push(text('-# ⚠️ Expeditions are paused by the staff team.'));
    if (note) parts.push(text(note));
    parts.push(text(`**Today's hazard:** ${hz.emoji} ${hz.name}-tainted zones${counter ? ` — ${FACTIONS[counter].emoji} ${FACTIONS[counter].name} squads earn **+25%** salvage and dodge ambushes` : ' — no faction holds the advantage today'}.${rec.faction ? `\n-# Your squad: ${FACTIONS[rec.faction].emoji} ${FACTIONS[rec.faction].name}` : '\n-# Pledge a faction with `/faction` to exploit the hazard.'}`));
    parts.push(separator());
    if (exp) {
      const route = EXPEDITION_ROUTES[exp.route];
      const done = Date.now() >= exp.ends_at;
      const elapsed = Math.min(exp.ends_at, Date.now()) - exp.started_at;
      parts.push(text(`### ${route.emoji} ${route.name}\n\`${bar(elapsed, exp.ends_at - exp.started_at, 12, { full: '█', empty: '░' })}\` ${done ? '**Squad has returned!**' : `returns ${discordTime(exp.ends_at, 'R')} (${discordTime(exp.ends_at, 't')})`}`));
      parts.push(row(
        button({ id: 'exp:claim', label: done ? 'Collect salvage' : 'Still out…', emoji: '🎒', style: ButtonStyle.Success, disabled: !done }),
        button({ id: 'exp:refresh', label: 'Refresh', emoji: ICON.refresh }),
        button({ id: 'exp:relics', label: 'Relic archive', emoji: ICON.relic }),
      ));
    } else {
      parts.push(text(Object.values(EXPEDITION_ROUTES).map((r) => `${r.emoji} **${r.name}** · ${r.hours}h — ${currency.emoji} ${r.shards[0]}–${r.shards[1]}, ${r.xp[0]}–${r.xp[1]} XP, ${Math.round(r.relicChance * 100)}% relic chance${r.ambush ? `, ${Math.round(r.ambush * 100)}% ambush risk` : ''}\n-# ${r.blurb}`).join('\n')));
      parts.push(row(stringSelect({
        id: 'exp:go',
        placeholder: left ? 'Choose a route to launch' : 'No launches left today',
        disabled: !left || !settings.expeditions.enabled,
        options: Object.values(EXPEDITION_ROUTES).map((r) => ({ label: `${r.name} (${r.hours}h)`, value: r.key, emoji: r.emoji, description: r.blurb })),
      })));
      parts.push(row(button({ id: 'exp:relics', label: 'Relic archive', emoji: ICON.relic })));
    }
    return v2([container({ accent: hz.color }, ...parts)], { ephemeral: true });
  }

  renderRelics(guildId, userId, { note } = {}) {
    const owned = this.relics(guildId, userId);
    const currency = this.bot.settings.currency(guildId);
    const found = RELICS.filter((r) => owned.get(r.key));
    const dupes = RELICS.reduce((a, r) => a + Math.max(0, (owned.get(r.key) || 0) - 1) * RELIC_SALVAGE[r.tier], 0);
    const lines = RELICS.map((r) => (owned.get(r.key)
      ? `${RELIC_TIER_COLORS[r.tier]} ${r.emoji} **${r.name}** · ${r.tier}${owned.get(r.key) > 1 ? ` ×${owned.get(r.key)}` : ''}`
      : `${RELIC_TIER_COLORS[r.tier]} ❔ *Undiscovered ${r.tier} relic*`));
    const parts = [text(`## ${ICON.relic} Relic archive\n-# ${found.length}/${RELICS.length} discovered · relics are found on Wildness Expeditions`)];
    if (note) parts.push(text(note));
    parts.push(separator(), text(lines.join('\n')));
    parts.push(row(
      button({ id: 'exp:salvage', label: dupes ? `Salvage duplicates (+${dupes})` : 'No duplicates', emoji: '♻️', style: ButtonStyle.Success, disabled: !dupes }),
      button({ id: 'exp:refresh', label: 'Expeditions', emoji: ICON.expedition }),
    ));
    parts.push(text(`-# Salvage values: R ${currency.emoji}${RELIC_SALVAGE.R} · SR ${currency.emoji}${RELIC_SALVAGE.SR} · SSR ${currency.emoji}${RELIC_SALVAGE.SSR} · UR ${currency.emoji}${RELIC_SALVAGE.UR}. One copy of each relic is always kept.`));
    return v2([container({ accent: COLORS.gold }, ...parts)], { ephemeral: true });
  }
}

export default function setup(bot) {
  const exps = new Expeditions(bot);
  bot.services.expeditions = exps;
  const respond = (ctx, payload) => (ctx.message?.flags & 64 ? ctx.update(payload) : ctx.reply(payload));

  bot.router.command({
    name: 'expedition',
    description: 'Send your squad into the Wildness for salvage, XP and relics.',
    async run(ctx) {
      await ctx.reply(exps.render(requireGuild(ctx), ctx.userId));
    },
  });

  bot.router.component('exp', async (ctx, action) => {
    const guildId = requireGuild(ctx);
    const currency = bot.settings.currency(guildId);
    switch (action) {
      case 'go': {
        exps.launch(guildId, ctx.userId, ctx.values[0]);
        const route = EXPEDITION_ROUTES[ctx.values[0]];
        return respond(ctx, exps.render(guildId, ctx.userId, { note: `> ${route.emoji} Squad deployed on **${route.name}** — back in ${route.hours}h.` }));
      }
      case 'claim': {
        const loot = exps.claim(guildId, ctx.userId);
        const lines = [`> 🎒 **${loot.route.name}** complete: +${currency.emoji} **${num(loot.shards)}** · +${loot.xp} XP`];
        if (loot.advantage) lines.push(`> ${FACTIONS[loot.hazard].emoji} Hazard advantage bonus applied!`);
        if (loot.ambushed) lines.push('> ⚠️ Your squad was ambushed and lost part of the salvage.');
        if (loot.relic) lines.push(`> ${ICON.relic} Relic recovered: ${RELIC_TIER_COLORS[loot.relic.tier]} ${loot.relic.emoji} **${loot.relic.name}** (${loot.relic.tier})`);
        return respond(ctx, exps.render(guildId, ctx.userId, { note: lines.join('\n') }));
      }
      case 'relics':
        return respond(ctx, exps.renderRelics(guildId, ctx.userId));
      case 'salvage': {
        const r = exps.salvageDuplicates(guildId, ctx.userId);
        return respond(ctx, exps.renderRelics(guildId, ctx.userId, { note: r.count ? `> ♻️ Salvaged ${r.count} duplicate${r.count === 1 ? '' : 's'} for +${currency.emoji} **${num(r.total)}**.` : '> Nothing to salvage.' }));
      }
      default:
        return respond(ctx, exps.render(guildId, ctx.userId));
    }
  });
}
