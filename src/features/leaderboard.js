// Leaderboards: season (default), lifetime, weekly, shards, voice and streak ladders.
import { OptionType } from '../core/interactions.js';
import { button, container, row, separator, stringSelect, text, v2, ButtonStyle } from '../core/components.js';
import { COLORS, ICON, rankFor } from '../content/theme.js';
import { medal, num } from '../util/format.js';
import { discordTime, nextMonthReset, nextWeekReset } from '../util/time.js';
import { isOwner, pager, requireGuild } from './common.js';
import { banner } from '../ui.js';

const PAGE = 10;

export const BOARDS = {
  season: { label: 'Season XP', emoji: '🏁', column: 'season_xp', unit: (r) => `${num(r.season_xp)} XP`, blurb: 'Resets with each season — prizes for the top Commanders.' },
  lifetime: { label: 'Lifetime level', emoji: '🎖️', column: 'xp', unit: (r) => `Lv ${r.level} · ${num(r.xp)} XP`, blurb: 'Every XP you have ever earned in the Sanctuary.' },
  weekly: { label: 'This week', emoji: '📅', column: 'weekly_xp', unit: (r) => `${num(r.weekly_xp)} XP`, blurb: 'Resets every Monday at the server reset hour.' },
  shards: { label: 'Wealth', emoji: '💠', column: 'shards', unit: (r, cur) => `${cur.emoji} ${num(r.shards)}`, blurb: 'Current Core Shards balance.' },
  voice: { label: 'Voice time', emoji: '🎙️', column: 'voice_minutes', unit: (r) => `${Math.floor(r.voice_minutes / 60)}h ${r.voice_minutes % 60}m`, blurb: 'Minutes spent talking with other Commanders.' },
  streak: { label: 'Best streak', emoji: '🔥', column: 'best_streak', unit: (r) => `${r.best_streak} days`, blurb: 'Longest consecutive Supply Airdrop streak.' },
};

export function renderLeaderboard(bot, guildId, viewerId, boardKey = 'season', page = 0, { ephemeral = false } = {}) {
  const board = BOARDS[boardKey] || BOARDS.season;
  const settings = bot.settings.get(guildId);
  const currency = bot.settings.currency(guildId);
  const total = bot.members.count(guildId, board.column);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const rows = bot.members.top(guildId, board.column, PAGE, p * PAGE);
  const state = bot.state.get(guildId);

  let subtitle = board.blurb;
  if (boardKey === 'season') subtitle = `Season ${state.season_no} · ends ${discordTime(nextMonthReset(Date.now(), settings.general.resetHour), 'R')}`;
  if (boardKey === 'weekly') subtitle = `Resets ${discordTime(nextWeekReset(Date.now(), settings.general.resetHour), 'R')}`;

  const lines = rows.length
    ? rows.map((r, i) => {
      const rank = p * PAGE + i + 1;
      const rk = rankFor(r.level);
      return `${medal(rank)} <@${r.user_id}> ${rk.emoji} — **${board.unit(r, currency)}**`;
    }).join('\n')
    : '*No Commanders on this ladder yet — chat, join voice and claim your `/daily` to get on the board.*';

  const myRank = bot.members.rank(guildId, viewerId, board.column);
  const me = bot.members.get(guildId, viewerId);
  const myLine = myRank ? `${ICON.me} Your position: **#${myRank}** of ${num(total)} · ${board.unit(me, currency)}` : `${ICON.me} You are not on this ladder yet.`;

  const owner = viewerId;
  const select = stringSelect({
    id: `lb:board:${owner}`,
    placeholder: 'Switch ladder',
    options: Object.entries(BOARDS).map(([key, b]) => ({ label: b.label, value: key, emoji: b.emoji, description: b.blurb.slice(0, 100), default: key === boardKey })),
  });
  const myPage = myRank ? Math.floor((myRank - 1) / PAGE) : p;
  const parts = [
    banner(settings),
    text(`## ${ICON.trophy} Leaderboard · ${board.emoji} ${board.label}\n-# ${subtitle}`),
    separator(),
    text(lines),
    separator(),
    text(`-# ${myLine} · Page ${p + 1}/${pages}`),
    row(select),
    pager(`lb:${boardKey}:${owner}`, p, pages, { center: button({ id: `lb:${boardKey}:${owner}:${myPage}:m`, emoji: ICON.me, label: 'Me', style: ButtonStyle.Secondary, disabled: !myRank }) }),
  ];
  return v2([container({ accent: COLORS.gold }, ...parts)], { ephemeral });
}

export default function setup(bot) {
  bot.router.command({
    name: 'leaderboard',
    description: 'Season, lifetime, weekly, wealth, voice and streak ladders.',
    options: [
      { type: OptionType.String, name: 'ladder', description: 'Which ladder to open', choices: Object.entries(BOARDS).map(([k, b]) => ({ name: b.label, value: k })) },
    ],
    async run(ctx) {
      const guildId = requireGuild(ctx);
      await ctx.reply(renderLeaderboard(bot, guildId, ctx.userId, ctx.option('ladder') || 'season', 0));
    },
  });

  // lb:board:<owner> (select) | lb:<board>:<owner>:<page>:<dir>
  bot.router.component('lb', async (ctx, a, b, c) => {
    const guildId = requireGuild(ctx);
    let boardKey;
    let owner;
    let page;
    if (a === 'board') {
      boardKey = ctx.values[0];
      owner = b;
      page = 0;
    } else {
      boardKey = a;
      owner = b;
      page = Number(c) || 0;
    }
    if (!isOwner(ctx, owner)) {
      await ctx.reply(renderLeaderboard(bot, guildId, ctx.userId, boardKey, page, { ephemeral: true }));
      return;
    }
    await ctx.update(renderLeaderboard(bot, guildId, ctx.userId, boardKey, page));
  });
}
