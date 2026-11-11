// Commander ID card (/profile + user context menu) with editable dossier and game-account link.
import { OptionType, CommandType, UserError } from '../core/interactions.js';
import { button, checkbox, container, label, modal, radioGroup, row, section, separator, text, textInput, thumbnail, v2, ButtonStyle, TextInputStyle } from '../core/components.js';
import { COLORS, FACTIONS, ICON, REGIONS, rankFor, nextRank } from '../content/theme.js';
import { RELICS, STELLARIS } from '../content/lore.js';
import { levelProgress } from './leveling/curve.js';
import { avatarUrl, displayName, num, sanitizeInline } from '../util/format.js';
import { discordTime, snowflakeTime } from '../util/time.js';
import { isOwner, requireGuild } from './common.js';
import { success } from '../ui.js';

/** Achievement badges derived from stats. */
export function badgesFor(row, stats, relicCount) {
  const out = [];
  if (row.level >= 50) out.push(['🎖️', 'Veteran']);
  if (row.best_streak >= 30) out.push(['🔥', 'Streak Keeper']);
  if (row.voice_minutes >= 6000) out.push(['🎙️', 'Voice of Pax']);
  if (row.messages >= 5000) out.push(['📡', 'Signal Booster']);
  if ((stats.breach_mvp || 0) >= 1 || (stats.breaches || 0) >= 10) out.push(['🚨', 'Breach Breaker']);
  if ((stats.trivia_wins || 0) >= 10) out.push(['🔐', 'Codebreaker']);
  if (relicCount >= 10) out.push(['🏺', 'Relic Hunter']);
  if ((stats.expeditions || 0) >= 25) out.push(['🧭', 'Pathfinder']);
  if ((stats.duel_wins || 0) >= 10) out.push(['⚔️', 'Duelist']);
  if ((stats.season_top3 || 0) >= 1) out.push(['🏆', 'Season Champion']);
  if ((stats.giveaway_wins || 0) >= 1) out.push(['🍀', 'Lucky Star']);
  if ((stats.drops || 0) >= 25) out.push(['📦', 'Quartermaster']);
  return out;
}

function relicCount(bot, guildId, userId) {
  return bot.db.get("SELECT COUNT(*) AS n FROM inventory WHERE guild_id = ? AND user_id = ? AND item_key LIKE 'relic:%' AND quantity > 0", guildId, userId).n;
}

/** Build the ID card payload for `userId` as seen by `viewerId`. */
export function renderProfile(bot, guildId, userId, { viewerId, user, member, ephemeral = false } = {}) {
  const settings = bot.settings.get(guildId);
  const rec = bot.members.get(guildId, userId) || bot.members.ensure(guildId, userId);
  const stats = bot.members.stats(rec);
  const progress = levelProgress(rec.xp, settings.leveling.curveScale);
  const rank = rankFor(progress.level);
  const upcoming = nextRank(progress.level);
  const currency = bot.settings.currency(guildId);
  const cached = bot.cache.member(guildId, userId);
  const userObj = user || (cached ? { id: userId, username: cached.username, global_name: cached.globalName, avatar: cached.avatar } : { id: userId });
  const name = sanitizeInline(displayName(userObj, member || (cached ? { nick: cached.nick } : null)), 40);
  const avatar = avatarUrl(userObj, { guildId, guildAvatar: member?.avatar || cached?.guildAvatar, size: 256 });
  const faction = FACTIONS[rec.faction];
  const accent = rec.accent ?? faction?.color ?? COLORS.primary;
  const seasonRank = bot.members.rank(guildId, userId, 'season_xp');
  const lifetimeRank = bot.members.rank(guildId, userId, 'xp');
  const relics = relicCount(bot, guildId, userId);
  const self = viewerId === userId;

  const headLines = [
    `## ${ICON.id} ${name}`,
    `${rank.emoji} **${rank.name}** · Level **${progress.level}**${rec.title ? ` · 「${sanitizeInline(rec.title, 40)}」` : ''}`,
    `-# ${faction ? `${faction.emoji} ${faction.name} faction` : 'No faction pledged'} · Commander since ${discordTime(rec.created_at || snowflakeTime(userId), 'D')}`,
  ];
  const parts = [section(headLines, thumbnail(avatar, `${name}'s avatar`))];
  if (rec.bio) parts.push(text(`> ${sanitizeInline(rec.bio, 200)}`));
  parts.push(separator());

  const bar = bot.emojis.bar(progress.into, progress.needed, 8);
  const progressLines = [
    `### ${ICON.xp} Progress`,
    `${bar} **${num(progress.into)} / ${num(progress.needed)} XP** to level ${progress.level + 1}`,
    `-# Lifetime ${num(rec.xp)} XP${lifetimeRank ? ` (#${lifetimeRank})` : ''} · Season ${num(rec.season_xp)} XP${seasonRank ? ` (#${seasonRank})` : ''} · This week ${num(rec.weekly_xp)} XP${upcoming ? ` · Next rank **${upcoming.name}** at Lv ${upcoming.min}` : ''}`,
  ];
  parts.push(text(progressLines.join('\n')));

  const hours = Math.floor(rec.voice_minutes / 60);
  parts.push(text([
    `### ${currency.emoji} Wallet & activity`,
    `${currency.long(rec.shards)} · ${ICON.streak} Streak **${rec.streak}** (best ${rec.best_streak})`,
    `${ICON.chat} ${num(rec.messages)} messages · ${ICON.voice} ${num(hours)}h voice · ${ICON.relic} ${relics}/${RELICS.length} relics`,
  ].join('\n')));

  const region = REGIONS[rec.game_region];
  if (region || rec.main_stellaris || rec.game_server) {
    const showUid = rec.game_uid && (rec.uid_public || self);
    const bits = [];
    if (region) bits.push(`${region.emoji} ${region.label}`);
    if (rec.game_server) bits.push(`Server **${sanitizeInline(rec.game_server, 16)}**`);
    if (showUid) bits.push(`UID \`${sanitizeInline(rec.game_uid, 20)}\`${rec.uid_public ? '' : ' *(only you see this)*'}`);
    const lines = [`### 🎮 In game`, bits.join(' · ') || '—'];
    if (rec.main_stellaris) lines.push(`Main Stellaris: **${sanitizeInline(rec.main_stellaris, 32)}**`);
    if (region) lines.push(`-# ${region.game}`);
    parts.push(text(lines.join('\n')));
  }

  const badges = badgesFor({ ...rec, level: progress.level }, stats, relics);
  if (badges.length) parts.push(text(`### ${ICON.star} Badges\n${badges.map(([e, n]) => `${e} ${n}`).join(' · ')}`));

  parts.push(separator());
  parts.push(row(
    button({ id: `prof:edit:${userId}`, label: 'Edit dossier', emoji: '✏️', style: ButtonStyle.Primary, disabled: !self }),
    button({ id: `prof:link:${userId}`, label: 'Link game account', emoji: '🎮', disabled: !self }),
    button({ id: 'quests:open', label: 'Directives', emoji: ICON.quest }),
    button({ id: 'inv:open', label: 'Inventory', emoji: ICON.inventory }),
  ));
  return v2([container({ accent }, ...parts)], { ephemeral });
}

function dossierModal(rec) {
  return modal({
    id: 'prof:dossier',
    title: 'Commander dossier',
    components: [
      label('Bio', textInput({ id: 'bio', style: TextInputStyle.Paragraph, max: 200, required: false, value: rec.bio, placeholder: 'A line or two about you, Commander.' }), 'Shown on your ID card. Max 200 characters.'),
      label('Main Stellaris', textInput({ id: 'main', max: 32, required: false, value: rec.main_stellaris, placeholder: 'e.g. Tsubaki' }), 'Your favourite or strongest Stellaris.'),
      label('Level-up pings', checkbox({ id: 'ping', checked: Boolean(rec.levelup_ping) }), 'Mention me when I level up.'),
    ],
  });
}

function linkModal(rec) {
  return modal({
    id: 'prof:linksave',
    title: 'Link your game account',
    components: [
      label('Game version', radioGroup({
        id: 'region',
        required: true,
        options: [
          { value: 'global', label: 'Global — Apex Girls: 3650-Pull Giveaway', default: rec.game_region === 'global' },
          { value: 'sea', label: 'Southeast Asia — Scarlet Girls: Elite Edition', default: rec.game_region === 'sea' },
          { value: 'none', label: 'Prefer not to say', default: !rec.game_region },
        ],
      })),
      label('Server', textInput({ id: 'server', max: 16, required: false, value: rec.game_server, placeholder: 'e.g. S12' }), 'The in-game server you play on.'),
      label('UID', textInput({ id: 'uid', max: 20, required: false, value: rec.game_uid, placeholder: 'Profile → copy your UID' }), 'Needed for in-game reward deliveries.'),
      label('Show UID publicly', checkbox({ id: 'public', checked: Boolean(rec.uid_public) }), 'Otherwise only you (and staff fulfilling rewards) see it.'),
    ],
  });
}

export default function setup(bot) {
  bot.router.command({
    name: 'profile',
    description: 'Show a Commander ID card — level, rank, wallet and game info.',
    options: [
      { type: OptionType.User, name: 'member', description: 'Commander to look up (default: you)' },
      { type: OptionType.Boolean, name: 'private', description: 'Only show the card to you' },
    ],
    async run(ctx) {
      const guildId = requireGuild(ctx);
      const target = ctx.optionUser('member');
      const userId = target?.id || ctx.userId;
      if (target?.user?.bot) throw new UserError('Bots do not carry Commander ID cards.', { title: 'No record', tone: 'warning' });
      const user = target?.user || ctx.user;
      const member = target ? target.member : ctx.member;
      if (!target) bot.cache.rememberMember(guildId, ctx.user, ctx.member);
      await ctx.reply(renderProfile(bot, guildId, userId, { viewerId: ctx.userId, user, member, ephemeral: Boolean(ctx.option('private')) }));
    },
  });

  bot.router.command({
    name: 'View Commander ID',
    type: CommandType.User,
    async run(ctx) {
      const guildId = requireGuild(ctx);
      const userId = ctx.data.target_id;
      const user = ctx.resolved.users?.[userId];
      if (user?.bot) throw new UserError('Bots do not carry Commander ID cards.', { title: 'No record', tone: 'warning' });
      await ctx.reply(renderProfile(bot, guildId, userId, { viewerId: ctx.userId, user, member: ctx.resolved.members?.[userId], ephemeral: true }));
    },
  });

  bot.router.component('prof', async (ctx, action, ownerId) => {
    const guildId = requireGuild(ctx);
    if (action === 'view') {
      await ctx.reply(renderProfile(bot, guildId, ownerId || ctx.userId, { viewerId: ctx.userId, ephemeral: true }));
      return;
    }
    if (!isOwner(ctx, ownerId)) throw new UserError('Only the card owner can edit it. Open your own with `/profile`.', { title: 'Not your card', tone: 'warning' });
    const rec = bot.members.ensure(guildId, ctx.userId);
    if (action === 'edit') return ctx.showModal(dossierModal(rec));
    if (action === 'link') return ctx.showModal(linkModal(rec));
    return undefined;
  });

  bot.router.modal('prof', async (ctx, action) => {
    const guildId = requireGuild(ctx);
    bot.members.ensure(guildId, ctx.userId);
    if (action === 'dossier') {
      const bio = String(ctx.field('bio', '') || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      let main = String(ctx.field('main', '') || '').trim().slice(0, 32);
      if (main && !/^[\p{L}\p{N}\s'’.\-]+$/u.test(main)) throw new UserError('Main Stellaris may only contain letters, numbers, spaces and hyphens.', { title: 'Invalid name', tone: 'warning' });
      const known = STELLARIS.find((n) => n.toLowerCase() === main.toLowerCase());
      if (known) main = known;
      bot.members.update(guildId, ctx.userId, { bio: bio || null, main_stellaris: main || null, levelup_ping: ctx.field('ping', false) === true ? 1 : 0 });
    } else if (action === 'linksave') {
      const region = ctx.field('region', 'none');
      const server = String(ctx.field('server', '') || '').trim().slice(0, 16);
      const uid = String(ctx.field('uid', '') || '').replace(/\s+/g, '').slice(0, 20);
      if (uid && !/^[A-Za-z0-9-]{4,20}$/.test(uid)) throw new UserError('That UID does not look right — use the letters/numbers shown on your in-game profile.', { title: 'Invalid UID', tone: 'warning' });
      if (server && !/^[\p{L}\p{N}\s#\-]+$/u.test(server)) throw new UserError('Server may only contain letters, numbers, spaces, # and -.', { title: 'Invalid server', tone: 'warning' });
      bot.members.update(guildId, ctx.userId, {
        game_region: region === 'none' ? null : region,
        game_server: server || null,
        game_uid: uid || null,
        uid_public: ctx.field('public', false) === true ? 1 : 0,
      });
    }
    if (ctx.message) await ctx.update(renderProfile(bot, guildId, ctx.userId, { viewerId: ctx.userId, user: ctx.user, member: ctx.member }));
    else await ctx.reply(success('Dossier updated', 'Your Commander ID card has been updated.'));
  });
}
