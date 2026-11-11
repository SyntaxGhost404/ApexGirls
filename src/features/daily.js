// Supply Airdrop (/daily): daily claim with streaks, milestones and Streak Shield protection.
import { button, container, row, section, separator, text, thumbnail, v2, ButtonStyle } from '../core/components.js';
import { COLORS, ICON } from '../content/theme.js';
import { dayKey, discordTime, nextDayReset } from '../util/time.js';
import { requireGuild } from './common.js';

export const SHIELD_KEY = 'consumable:streak_shield';

export function airdropReward(settings, streak) {
  const e = settings.economy;
  let shards = e.dailyBase + Math.min(e.streakBonus * Math.max(0, streak - 1), e.streakBonusCap);
  let milestone = null;
  if (streak > 0 && streak % 30 === 0) {
    shards += e.milestone30;
    milestone = '30-day Commander cache';
  } else if (streak > 0 && streak % 7 === 0) {
    shards += e.milestone7;
    milestone = '7-day supply cache';
  }
  return { shards, xp: 25 + Math.min(streak, 10) * 3, milestone };
}

/** Claim logic, separated for testing. Returns { claimed, ... }. */
export function claimAirdrop(bot, guildId, userId, now = Date.now()) {
  const settings = bot.settings.get(guildId);
  const today = dayKey(now, settings.general.resetHour);
  return bot.db.tx(() => {
    const rec = bot.members.ensure(guildId, userId);
    if (rec.last_daily_day === today) return { claimed: false, streak: rec.streak, next: nextDayReset(now, settings.general.resetHour) };
    let streak = 1;
    let shieldUsed = false;
    if (rec.last_daily_day === today - 1) streak = rec.streak + 1;
    else if (rec.last_daily_day === today - 2 && rec.streak > 0) {
      const shield = bot.db.get('SELECT quantity FROM inventory WHERE guild_id = ? AND user_id = ? AND item_key = ?', guildId, userId, SHIELD_KEY);
      if (shield?.quantity > 0) {
        bot.db.run('UPDATE inventory SET quantity = quantity - 1 WHERE guild_id = ? AND user_id = ? AND item_key = ?', guildId, userId, SHIELD_KEY);
        streak = rec.streak + 1;
        shieldUsed = true;
      }
    }
    const reward = airdropReward(settings, streak);
    bot.members.update(guildId, userId, {
      streak,
      best_streak: Math.max(rec.best_streak, streak),
      last_daily_day: today,
      daily_claims: rec.daily_claims + 1,
    });
    const balance = bot.economy.credit(guildId, userId, reward.shards, 'daily', { reason: `Supply Airdrop (streak ${streak})` });
    return { claimed: true, streak, best: Math.max(rec.best_streak, streak), shieldUsed, reward, balance, lost: rec.streak > 1 && streak === 1 ? rec.streak : 0, next: nextDayReset(now, settings.general.resetHour) };
  });
}

export function renderAirdrop(bot, guildId, userId, result) {
  const currency = bot.settings.currency(guildId);
  const settings = bot.settings.get(guildId);
  if (!result.claimed) {
    return v2([container({ accent: COLORS.steel },
      text(`### ${ICON.clock} Airdrop already secured\nYour Sanctuary Core is recharging. Next airdrop ${discordTime(result.next, 'R')} (${discordTime(result.next, 't')}).\n-# Current streak: ${ICON.streak} **${result.streak}** day${result.streak === 1 ? '' : 's'}`),
      row(button({ id: 'quests:open', label: 'Directives', emoji: ICON.quest }), button({ id: 'shop:open', label: 'Supply Depot', emoji: ICON.shop })),
    )], { ephemeral: true });
  }
  const toNext7 = 7 - (result.streak % 7);
  const lines = [
    `## ${ICON.airdrop} Supply Airdrop secured`,
    `+${currency.long(result.reward.shards)}  ·  +${result.reward.xp} XP`,
    `${ICON.streak} Streak **${result.streak}** day${result.streak === 1 ? '' : 's'} (best ${result.best})`,
  ];
  if (result.reward.milestone) lines.push(`🎉 **${result.reward.milestone}** unlocked!`);
  if (result.shieldUsed) lines.push(`${ICON.shield} A **Streak Shield** absorbed your missed day.`);
  if (result.lost) lines.push(`-# Your previous ${result.lost}-day streak lapsed. Streak Shields in the Supply Depot protect against a missed day.`);
  lines.push(`-# Balance ${currency.fmt(result.balance)} · next milestone in ${toNext7} day${toNext7 === 1 ? '' : 's'} · next airdrop ${discordTime(result.next, 'R')}`);
  const pic = settings.branding.bannerUrl && /^https:\/\//.test(settings.branding.bannerUrl) ? settings.branding.bannerUrl : null;
  const body = pic ? section(lines.join('\n'), thumbnail(pic)) : text(lines.join('\n'));
  return v2([container({ accent: COLORS.gold },
    body,
    separator(),
    row(
      button({ id: 'quests:open', label: 'Directives', emoji: ICON.quest, style: ButtonStyle.Primary }),
      button({ id: 'shop:open', label: 'Supply Depot', emoji: ICON.shop }),
      button({ id: 'prof:view', label: 'My ID card', emoji: ICON.id }),
    ),
  )], { ephemeral: false });
}

export default function setup(bot) {
  async function claim(ctx) {
    const guildId = requireGuild(ctx);
    const result = claimAirdrop(bot, guildId, ctx.userId);
    if (result.claimed) {
      bot.services.leveling.addXp(guildId, ctx.userId, result.reward.xp, { source: 'daily', channelId: ctx.channelId });
      bot.activity({ type: 'daily', guildId, userId: ctx.userId });
    }
    await ctx.reply(renderAirdrop(bot, guildId, ctx.userId, result));
  }

  bot.router.command({ name: 'daily', description: 'Claim your daily Supply Airdrop and keep your streak alive.', run: claim });
  bot.router.component('daily', async (ctx) => claim(ctx));
}
