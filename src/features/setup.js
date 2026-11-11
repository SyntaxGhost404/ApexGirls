// /setup — schema-driven staff control panel. Every numeric/text/enum/flag setting is edited
// through validated modals; channels and roles are picked with select menus; the Supply Depot
// catalogue has a full item editor. Only members with Manage Server can open it.
import { UserError } from '../core/interactions.js';
import { button, channelSelect, checkboxGroup, container, label, modal, radioGroup, roleSelect, row, section, separator, stringSelect, text, textInput, v2, ButtonStyle, ChannelTypes, TextInputStyle } from '../core/components.js';
import { canAssignRole, canPost, botGuildPermissions, has, P } from '../core/permissions.js';
import { COLORS, FACTIONS, FACTION_KEYS, ICON } from '../content/theme.js';
import { ITEM_KINDS, PERIODS } from '../content/defaults.js';
import { getPath } from '../services/settings.js';
import { num, sanitizeInline } from '../util/format.js';
import { requireGuild } from './common.js';

const MANAGE_GUILD = String(1 << 5);
const TEXT_CHANNELS = [ChannelTypes.GuildText, ChannelTypes.GuildAnnouncement];

const int = (path, labelText, min, max, desc) => ({ path, label: labelText, type: 'int', min, max, desc });
const flags = (labelText, options, desc) => ({ type: 'flags', label: labelText, options, desc });

/** Modal groups: each is one modal with ≤5 fields. */
export const GROUPS = {
  chat: { title: 'Chat XP rules', fields: [
    int('leveling.chatXpMin', 'XP per message — minimum', 0, 500),
    int('leveling.chatXpMax', 'XP per message — maximum', 0, 500),
    int('leveling.cooldownSec', 'Cooldown between XP messages (s)', 5, 3600, 'One XP-earning message per member per cooldown'),
    int('leveling.minChars', 'Minimum message length', 0, 200, 'CJK characters count double'),
    int('leveling.conversationBonus', 'Conversation bonus (%)', 0, 300, 'For replies and lively multi-member chats'),
  ] },
  limits: { title: 'Daily limits & XP curve', fields: [
    int('leveling.softCap', 'Daily chat XP soft cap', 0, 1_000_000, 'Chat XP is halved after this much per day'),
    int('leveling.hardCap', 'Daily chat XP hard cap', 0, 1_000_000, 'Chat stops earning XP after this'),
    int('leveling.shardsPerMessage', 'Shards per XP-earning message', 0, 1000),
    int('leveling.chatShardsDailyCap', 'Daily chat shards cap', 0, 1_000_000),
    int('leveling.curveScale', 'XP curve scale (%)', 25, 400, '100 = standard · 200 = levels need twice the XP'),
  ] },
  levelup: { title: 'Level-up rewards & messages', fields: [
    int('leveling.levelShardsBase', 'Shards per level-up — base', 0, 1_000_000),
    int('leveling.levelShardsPerLevel', 'Shards per level-up — per level', 0, 100_000),
    int('leveling.announceFromLevel', 'Announce from level', 1, 500),
    { path: 'leveling.announceMode', label: 'Where to announce level-ups', type: 'enum', options: [['current', 'Reply where the member chatted'], ['channel', 'Level-up channel only'], ['dm', 'Direct message'], ['off', 'Do not announce']] },
    flags('Options', [{ path: 'leveling.announcePing', label: 'Ping the member', description: 'Members can opt out on their ID card' }, { path: 'leveling.stackRewards', label: 'Keep lower level-reward roles', description: 'Off = only the highest reward role is kept' }]),
  ] },
  voice: { title: 'Voice XP', fields: [
    flags('Voice rules', [{ path: 'voice.enabled', label: 'Voice XP enabled' }, { path: 'voice.requireUnmuted', label: 'Muted members earn nothing', description: 'Deafened members never earn' }]),
    int('voice.xpPerMinute', 'XP per minute', 0, 100),
    int('voice.shardsPer10Min', 'Shards per 10 minutes', 0, 10_000),
    int('voice.dailyXpCap', 'Daily voice XP cap', 0, 1_000_000),
    int('voice.minHumans', 'Members needed in the channel', 1, 25, 'Solo AFK farming earns nothing'),
  ] },
  airdrop: { title: 'Supply Airdrop (/daily)', fields: [
    int('economy.dailyBase', 'Base reward', 0, 1_000_000),
    int('economy.streakBonus', 'Bonus per streak day', 0, 100_000),
    int('economy.streakBonusCap', 'Maximum streak bonus', 0, 1_000_000),
    int('economy.milestone7', '7-day milestone bonus', 0, 1_000_000),
    int('economy.milestone30', '30-day milestone bonus', 0, 10_000_000),
  ] },
  branding: { title: 'Branding & reset time', fields: [
    { path: 'branding.currencyName', label: 'Currency name', type: 'string', min: 2, max: 32 },
    { path: 'branding.currencyEmoji', label: 'Currency emoji', type: 'emoji', desc: 'A Unicode emoji or <:name:id>' },
    { path: 'branding.bannerUrl', label: 'Banner image URL', type: 'url', desc: 'https:// image (e.g. official art) shown on panels' },
    int('general.resetHour', 'Daily reset hour (UTC)', 0, 23, 'Days, weeks and seasons roll over at this hour'),
  ] },
  drops: { title: 'Supply drops', fields: [
    flags('Automatic drops', [{ path: 'events.dropsEnabled', label: 'Spawn drops in busy drop channels' }]),
    int('events.dropChancePermille', 'Chance per XP message (‰)', 0, 1000, '10‰ = 1 in 100 XP-earning messages'),
    int('events.dropMaxPerDay', 'Maximum drops per day', 0, 200),
    int('events.dropCooldownMin', 'Minutes between drops', 1, 1440),
    int('events.dropClaimers', 'Claimers per crate', 1, 50),
  ] },
  dropRewards: { title: 'Drop rewards', fields: [
    int('events.dropRewardMin', 'Reward per claimer — minimum', 0, 1_000_000),
    int('events.dropRewardMax', 'Reward per claimer — maximum', 0, 1_000_000),
    int('events.dropMinLevel', 'Minimum level to claim', 0, 500),
  ] },
  breach: { title: 'Calamity Breach', fields: [
    flags('Automation', [{ path: 'events.breachAuto', label: 'One automatic breach per day', description: 'Spawns in the events channel within the window' }]),
    int('events.breachWindowStart', 'Window start hour (UTC)', 0, 23),
    int('events.breachWindowEnd', 'Window end hour (UTC)', 1, 24),
    int('events.breachDurationMin', 'Breach duration (minutes)', 5, 180),
    int('events.breachRewardPool', 'Reward pool (shards)', 0, 10_000_000),
  ] },
  trivia: { title: 'Signal Decryption (trivia)', fields: [
    int('events.triviaRewardFirst', 'Reward — first correct answer', 0, 1_000_000),
    int('events.triviaRewardOthers', 'Reward — other winners', 0, 1_000_000),
    int('events.triviaWinners', 'Number of winners', 1, 10),
    int('events.triviaSeconds', 'Answer window (seconds)', 15, 600),
  ] },
  quests: { title: 'Directives', fields: [
    flags('Directives', [{ path: 'quests.enabled', label: 'Directives enabled' }]),
    int('quests.dailyCount', 'Daily directives per member', 1, 5),
    int('quests.weeklyCount', 'Weekly directives per member', 1, 5),
    int('quests.allClearBonus', 'Daily all-clear bonus', 0, 1_000_000),
  ] },
  factions: { title: 'Faction Clash', fields: [
    flags('Factions', [{ path: 'factions.enabled', label: 'Faction Clash enabled' }]),
    int('factions.weeklyReward', 'Weekly victory reward', 0, 1_000_000),
    int('factions.minContribution', 'Points needed for the reward', 0, 1_000_000),
    int('factions.contributionCap', 'Max points per member per week', 1, 10_000_000),
    int('factions.switchCooldownDays', 'Days between faction switches', 0, 365),
  ] },
  side: { title: 'Expeditions & duels', fields: [
    flags('Modules', [{ path: 'expeditions.enabled', label: 'Expeditions enabled' }, { path: 'duels.enabled', label: 'Duels enabled' }]),
    int('expeditions.dailyLaunches', 'Expedition launches per day', 0, 24),
    int('duels.maxStake', 'Maximum duel stake', 0, 10_000_000),
    int('duels.dailyLimit', 'Duels per member per day', 0, 100),
    int('duels.taxPercent', 'Duel tax (%)', 0, 50, 'Removed from the pot as a shard sink'),
  ] },
  seasons: { title: 'Seasons & welcome', fields: [
    flags('Modules', [{ path: 'seasons.enabled', label: 'Monthly seasons with prizes' }, { path: 'welcome.enabled', label: 'Welcome cards for new members', description: 'Needs the Server Members intent' }]),
    { path: 'seasons.rewards', label: 'Season prizes (#1, #2, …)', type: 'intlist', max: 10, desc: 'Comma separated shard amounts, up to 10' },
    { path: 'welcome.message', label: 'Welcome message', type: 'text', max: 400, desc: '{user} becomes the new member mention(s)' },
  ] },
};

const SECTIONS = {
  overview: { label: 'Overview & health', emoji: '🩺' },
  channels: { label: 'Channels', emoji: '📡' },
  leveling: { label: 'Leveling', emoji: '⬆️' },
  economy: { label: 'Economy & voice', emoji: '💠' },
  events: { label: 'Events', emoji: '🚨' },
  community: { label: 'Community modules', emoji: '🏳️' },
  roles: { label: 'Roles & rewards', emoji: '🎭' },
  depot: { label: 'Supply Depot', emoji: '🛒' },
};

const CHANNEL_FIELDS = [
  ['leveling.announceChannelId', 'Level-up announcements', 'Used for the "channel" mode and voice level-ups'],
  ['events.channelId', 'Events & results', 'Breaches, faction results and season podiums'],
  ['shop.requisitionChannelId', 'Requisition queue (staff)', 'Tickets for in-game rewards — keep it staff-only'],
  ['general.logChannelId', 'Staff audit log', 'Adjustments, purchases, giveaways — staff-only'],
  ['welcome.channelId', 'Welcome cards', 'Where new members are greeted'],
];

function fmtValue(field, value) {
  if (field.type === 'enum') return field.options.find(([v]) => v === value)?.[1] ?? String(value);
  if (field.type === 'intlist') return (value || []).map((n) => num(n)).join(', ') || '—';
  if (field.type === 'url') return value ? 'set' : 'not set';
  if (field.type === 'int') return num(value);
  return value === undefined || value === null || value === '' ? '—' : sanitizeInline(String(value), 60);
}

function groupSummary(settings, key) {
  const g = GROUPS[key];
  const bits = [];
  for (const f of g.fields) {
    if (f.type === 'flags') bits.push(f.options.map((o) => `${getPath(settings, o.path) ? '🟢' : '⚪'} ${o.label}`).join(' · '));
    else bits.push(`${f.label}: **${fmtValue(f, getPath(settings, f.path))}**`);
  }
  return bits.join('\n');
}

function groupBlock(settings, key) {
  return section([`**${GROUPS[key].title}**`, `-# ${groupSummary(settings, key).split('\n').join(' · ')}`.slice(0, 1200)], button({ id: `setup:edit:${key}`, label: 'Edit', emoji: '✏️' }));
}

export default function setup(bot) {
  const catalog = () => bot.services.catalog;

  function nav(current) {
    return row(stringSelect({ id: 'setup:nav', placeholder: 'Jump to section', options: Object.entries(SECTIONS).map(([k, s]) => ({ label: s.label, value: k, emoji: s.emoji, default: k === current })) }));
  }

  function shell(sectionKey, parts, { note, accent = COLORS.steel } = {}) {
    const s = SECTIONS[sectionKey];
    return v2([container({ accent },
      text(`## ${ICON.settings} Sanctuary Core setup · ${s.emoji} ${s.label}`),
      note ? text(note) : null,
      ...parts,
      separator(),
      nav(sectionKey),
    )], { ephemeral: true });
  }

  function overview(guildId, note) {
    const settings = bot.settings.get(guildId);
    const guildPerms = botGuildPermissions(bot.cache, guildId);
    const check = (id, opts) => {
      if (!id) return '⚪ not set';
      const r = canPost(bot.cache, guildId, id, opts);
      return r.ok ? `🟢 <#${id}>` : `🔴 <#${id}> — missing ${r.missing.join(', ')}`;
    };
    const rewardIssues = settings.leveling.rewards.map((r) => ({ r, c: canAssignRole(bot.cache, guildId, r.roleId) })).filter((x) => !x.c.ok);
    const factionRoleIssues = Object.entries(settings.factions.roleIds || {}).filter(([, id]) => id).map(([k, id]) => ({ k, c: canAssignRole(bot.cache, guildId, id) })).filter((x) => !x.c.ok);
    const stats = bot.db.get('SELECT COUNT(*) AS members, SUM(weekly_xp > 0) AS active FROM members WHERE guild_id = ? AND left_guild = 0', guildId);
    const pending = bot.db.get("SELECT COUNT(*) AS n FROM requisitions WHERE guild_id = ? AND status = 'pending'", guildId).n;
    const lines = [
      `### 🛰️ Core status\nGateway ${bot.gateway?.ping >= 0 ? `${bot.gateway.ping}ms` : '—'} · uptime ${Math.round(process.uptime() / 3600)}h · v${bot.config.version}\nMessage Content intent ${bot.contentIntent ? '🟢 anti-spam text checks active' : '🔴 off — only cooldown checks'} · Server Members intent ${bot.membersIntent ? '🟢' : '🔴 welcome cards & leaver tracking off'}`,
      `### 📡 Channels\n${CHANNEL_FIELDS.map(([p, l]) => `${l}: ${check(getPath(settings, p), { embeds: p.includes('requisition') || p.includes('log') })}`).join('\n')}`,
      `### 🎭 Roles\nManage Roles: ${has(guildPerms, P.MANAGE_ROLES) ? '🟢' : '🔴 missing — level/faction/depot role rewards cannot be granted'}${rewardIssues.length ? `\n${rewardIssues.map((x) => `🔴 Lv ${x.r.level} reward: ${x.c.reason}`).join('\n')}` : ''}${factionRoleIssues.length ? `\n${factionRoleIssues.map((x) => `🔴 ${FACTIONS[x.k].name} role: ${x.c.reason}`).join('\n')}` : ''}`,
      `### 📊 Community\n${num(stats.members || 0)} Commanders tracked · ${num(stats.active || 0)} active this week · ${pending} pending requisition${pending === 1 ? '' : 's'}`,
    ];
    const tips = [];
    if (!settings.events.channelId) tips.push('Set an **Events** channel so breaches, trivia and season results have a home.');
    if (!settings.events.dropChannelIds.length) tips.push('Pick **drop channels** (Events section) to enable automatic Supply Drops.');
    if (!settings.shop.requisitionChannelId) tips.push('Set a staff-only **Requisition queue** before enabling in-game rewards in the Depot.');
    if (!settings.leveling.rewards.length) tips.push('Add **level reward roles** (Roles & rewards) so ranks show in the member list.');
    if (tips.length) lines.push(`### 💡 Next steps\n${tips.map((t) => `• ${t}`).join('\n')}`);
    return shell('overview', [text(lines.join('\n'))], { note, accent: COLORS.primary });
  }

  function channels(guildId, note) {
    const settings = bot.settings.get(guildId);
    const parts = [];
    for (const [path, title, desc] of CHANNEL_FIELDS) {
      parts.push(text(`**${title}**\n-# ${desc}`));
      parts.push(row(channelSelect({ id: `setup:ch:${path}`, placeholder: `Choose the ${title.toLowerCase()} channel`, channelTypes: TEXT_CHANNELS, min: 0, max: 1, defaults: [getPath(settings, path)].filter(Boolean) })));
    }
    return shell('channels', parts, { note });
  }

  function leveling(guildId, note) {
    const settings = bot.settings.get(guildId);
    const s = settings.leveling;
    const mults = Object.entries(s.channelMultipliers).map(([id, pct]) => `<#${id}> ${pct}%`).concat(Object.entries(s.roleMultipliers).map(([id, pct]) => `<@&${id}> ${pct}%`));
    return shell('leveling', [
      section(['**Module**', `-# Leveling is ${s.enabled ? '🟢 on' : '⚪ off'}`], button({ id: 'setup:toggle:leveling.enabled', label: s.enabled ? 'Pause leveling' : 'Enable leveling', style: s.enabled ? ButtonStyle.Danger : ButtonStyle.Success })),
      groupBlock(settings, 'chat'),
      groupBlock(settings, 'limits'),
      groupBlock(settings, 'levelup'),
      section(['**Multipliers & exclusions**', `-# ${mults.length ? mults.join(' · ') : 'No multipliers'} · ${s.noXpChannelIds.length} blocked channel(s) · ${s.noXpRoleIds.length} blocked role(s)`.slice(0, 1000)], button({ id: 'setup:mult', label: 'Manage', emoji: '⚖️' })),
    ], { note });
  }

  function economy(guildId, note) {
    const settings = bot.settings.get(guildId);
    return shell('economy', [groupBlock(settings, 'airdrop'), groupBlock(settings, 'branding'), groupBlock(settings, 'voice')], { note });
  }

  function events(guildId, note) {
    const settings = bot.settings.get(guildId);
    return shell('events', [
      groupBlock(settings, 'drops'),
      groupBlock(settings, 'dropRewards'),
      text('**Drop channels**\n-# Automatic Supply Drops only spawn in these channels (during lively conversations)'),
      row(channelSelect({ id: 'setup:ms:events.dropChannelIds', placeholder: 'Channels where drops can spawn', channelTypes: TEXT_CHANNELS, min: 0, max: 25, defaults: settings.events.dropChannelIds })),
      groupBlock(settings, 'breach'),
      groupBlock(settings, 'trivia'),
    ], { note });
  }

  function community(guildId, note) {
    const settings = bot.settings.get(guildId);
    return shell('community', [groupBlock(settings, 'quests'), groupBlock(settings, 'factions'), groupBlock(settings, 'side'), groupBlock(settings, 'seasons')], { note });
  }

  function roles(guildId, note) {
    const settings = bot.settings.get(guildId);
    const rewards = [...settings.leveling.rewards].sort((a, b) => a.level - b.level);
    const fr = settings.factions.roleIds || {};
    const parts = [
      text('**Staff roles**\n-# Can use `/staff` tools and handle requisitions (Manage Server members always can)'),
      row(roleSelect({ id: 'setup:ms:general.staffRoleIds', placeholder: 'Staff roles', min: 0, max: 10, defaults: settings.general.staffRoleIds })),
      text('**Event host roles**\n-# Can run `/giveaway`'),
      row(roleSelect({ id: 'setup:ms:giveaways.hostRoleIds', placeholder: 'Giveaway host roles', min: 0, max: 10, defaults: settings.giveaways.hostRoleIds })),
      separator(),
      section([`**Level reward roles**`, rewards.length ? rewards.map((r) => `Lv **${r.level}** → <@&${r.roleId}>${canAssignRole(bot.cache, guildId, r.roleId).ok ? '' : ' ⚠️'}`).join(' · ') : '-# None yet — reward roles make ranks visible in the member list.'], button({ id: 'setup:rw:add', label: 'Add / change', emoji: '➕', style: ButtonStyle.Success })),
    ];
    if (rewards.length) parts.push(row(stringSelect({ id: 'setup:rw:rm', placeholder: 'Remove a level reward', options: rewards.map((r) => ({ label: `Level ${r.level}`, value: String(r.level), description: bot.cache.guild(guildId)?.roles.get(r.roleId)?.name?.slice(0, 100) || r.roleId })) })));
    parts.push(section(['**Faction roles**', FACTION_KEYS.map((k) => `${FACTIONS[k].emoji} ${fr[k] ? `<@&${fr[k]}>` : '—'}`).join(' · ')], button({ id: 'setup:fr', label: 'Edit', emoji: '✏️' })));
    return shell('roles', parts, { note });
  }

  function depot(guildId, note) {
    const items = catalog().list(guildId, { includeDisabled: true });
    const currency = bot.settings.currency(guildId);
    const lines = items.slice(0, 20).map((i) => `${i.enabled ? '🟢' : '⚪'} ${i.emoji || ITEM_KINDS[i.kind]?.emoji || ''} **${sanitizeInline(i.name, 50)}** — ${currency.emoji} ${num(i.price)} · ${ITEM_KINDS[i.kind]?.label || i.kind}`);
    const parts = [
      text(`**Catalogue** (${items.length} items · ${items.filter((i) => i.enabled).length} on sale)\n${lines.join('\n') || '*Empty*'}`),
      row(button({ id: 'setup:inew', label: 'New item', emoji: '➕', style: ButtonStyle.Success })),
    ];
    if (items.length) parts.push(row(stringSelect({ id: 'setup:iedit', placeholder: 'Edit an item', options: items.slice(0, 25).map((i) => ({ label: i.name.slice(0, 100), value: String(i.id), emoji: i.emoji || ITEM_KINDS[i.kind]?.emoji, description: `${i.enabled ? 'On sale' : 'Hidden'} · ${num(i.price)} · ${ITEM_KINDS[i.kind]?.label || i.kind}` })) })));
    parts.push(text('-# In-game reward items start hidden: enable them once your team is ready to fulfil requisitions.'));
    return shell('depot', parts, { note });
  }

  function itemEditor(guildId, id, note) {
    const item = catalog().get(guildId, id);
    if (!item) return depot(guildId, '> That item was deleted.');
    const currency = bot.settings.currency(guildId);
    const sold = catalog().sold(guildId, item);
    const kindLine = item.kind === 'title' ? `Title text: 「${sanitizeInline(item.data.title || item.name, 40)}」`
      : item.kind === 'accent' ? `Colour: \`#${Number(item.data.color ?? 0).toString(16).padStart(6, '0')}\``
        : item.kind === 'role' ? `Role: ${item.role_id ? `<@&${item.role_id}>${canAssignRole(bot.cache, guildId, item.role_id).ok ? '' : ' ⚠️ cannot be assigned'}` : '⚠️ not set'}${item.data.days ? ` · ${item.data.days} days` : ' · permanent'}`
          : item.kind === 'consumable' ? `Effect: ${item.data.effect === 'streak_shield' ? 'Streak Shield' : `+${(item.data.percent || 125) - 100}% XP for ${item.data.minutes || 60} min`}`
            : 'Creates a staff requisition (UID required)';
    return shell('depot', [
      text([
        `### ${item.emoji || ''} ${sanitizeInline(item.name, 80)} ${item.enabled ? '🟢 on sale' : '⚪ hidden'}`,
        sanitizeInline(item.description, 300) || '*No description*',
        `${ITEM_KINDS[item.kind]?.emoji || ''} ${ITEM_KINDS[item.kind]?.label} · ${currency.long(item.price)} · min level ${item.min_level}`,
        kindLine,
        `Limit: ${item.limit_count ? `${item.limit_count} ${PERIODS[item.limit_period]}` : 'none'} · Stock: ${item.stock === null ? 'unlimited' : `${item.stock} ${PERIODS[item.stock_period] === 'No limit' ? 'total' : PERIODS[item.stock_period]}${sold !== null ? ` (${sold} sold)` : ''}`}`,
      ].join('\n')),
      row(
        button({ id: `setup:ibasic:${item.id}`, label: 'Details', emoji: '✏️' }),
        button({ id: `setup:ilimit:${item.id}`, label: 'Limits & stock', emoji: '📦' }),
        button({ id: `setup:ikind:${item.id}`, label: ITEM_KINDS[item.kind]?.label || 'Type settings', emoji: ITEM_KINDS[item.kind]?.emoji || '⚙️', disabled: item.kind === 'fulfillment' }),
      ),
      row(
        button({ id: `setup:itoggle:${item.id}`, label: item.enabled ? 'Hide from depot' : 'Put on sale', emoji: item.enabled ? '🙈' : '🛒', style: item.enabled ? ButtonStyle.Secondary : ButtonStyle.Success }),
        button({ id: `setup:idel:${item.id}`, label: 'Delete', emoji: '🗑️', style: ButtonStyle.Danger }),
        button({ id: 'setup:sec:depot', label: 'Back to catalogue', emoji: ICON.back }),
      ),
    ], { note });
  }

  const RENDER = { overview, channels, leveling, economy, events, community, roles, depot };
  const SECTION_OF = { chat: 'leveling', limits: 'leveling', levelup: 'leveling', voice: 'economy', airdrop: 'economy', branding: 'economy', drops: 'events', dropRewards: 'events', breach: 'events', trivia: 'events', quests: 'community', factions: 'community', side: 'community', seasons: 'community' };

  function requireManager(ctx) {
    requireGuild(ctx);
    if (!ctx.isManager) throw new UserError('The control panel needs the **Manage Server** permission.', { title: 'Managers only' });
  }

  function groupModal(guildId, key) {
    const settings = bot.settings.get(guildId);
    const g = GROUPS[key];
    return modal({
      id: `setup:save:${key}`,
      title: g.title,
      components: g.fields.map((f, i) => {
        const id = `f${i}`;
        if (f.type === 'flags') return label(f.label, checkboxGroup({ id, required: false, min: 0, max: f.options.length, options: f.options.map((o) => ({ value: o.path, label: o.label, description: o.description, default: Boolean(getPath(settings, o.path)) })) }), f.desc);
        if (f.type === 'enum') return label(f.label, radioGroup({ id, options: f.options.map(([value, l]) => ({ value, label: l, default: getPath(settings, f.path) === value })) }), f.desc);
        const value = getPath(settings, f.path);
        if (f.type === 'intlist') return label(f.label, textInput({ id, max: 200, required: false, value: (value || []).join(', ') }), f.desc);
        if (f.type === 'text') return label(f.label, textInput({ id, style: TextInputStyle.Paragraph, max: f.max, required: false, value }), f.desc);
        if (f.type === 'url') return label(f.label, textInput({ id, max: 500, required: false, value, placeholder: 'https://…' }), f.desc);
        if (f.type === 'emoji') return label(f.label, textInput({ id, max: 64, value }), f.desc);
        if (f.type === 'string') return label(f.label, textInput({ id, min: f.min, max: f.max, value }), f.desc);
        return label(f.label, textInput({ id, max: String(f.max).length + 1, value: String(value ?? ''), placeholder: `${f.min}–${f.max}` }), f.desc || `Between ${num(f.min)} and ${num(f.max)}`);
      }),
    });
  }

  function readGroup(ctx, key) {
    const g = GROUPS[key];
    const entries = [];
    g.fields.forEach((f, i) => {
      const raw = ctx.field(`f${i}`);
      if (f.type === 'flags') {
        const on = new Set(Array.isArray(raw) ? raw : []);
        for (const o of f.options) entries.push([o.path, on.has(o.path)]);
        return;
      }
      if (f.type === 'enum') {
        if (raw && f.options.some(([v]) => v === raw)) entries.push([f.path, raw]);
        return;
      }
      const s = String(raw ?? '').trim();
      if (f.type === 'int') {
        const n = Number(s.replace(/[,_\s]/g, ''));
        if (!Number.isInteger(n) || n < f.min || n > f.max) throw new UserError(`**${f.label}** must be a whole number from ${num(f.min)} to ${num(f.max)}.`, { title: 'Invalid value', tone: 'warning' });
        entries.push([f.path, n]);
      } else if (f.type === 'intlist') {
        const list = s ? s.split(/[,;\s]+/).filter(Boolean).map((x) => Number(x)) : [];
        if (list.length > f.max || list.some((n) => !Number.isInteger(n) || n < 0 || n > 100_000_000)) throw new UserError(`**${f.label}** must be up to ${f.max} whole numbers separated by commas.`, { title: 'Invalid list', tone: 'warning' });
        entries.push([f.path, list]);
      } else if (f.type === 'url') {
        if (s && !/^https:\/\/\S{4,500}$/.test(s)) throw new UserError('The banner must be an https:// link to an image.', { title: 'Invalid URL', tone: 'warning' });
        entries.push([f.path, s]);
      } else if (f.type === 'emoji') {
        const ok = /^<a?:\w{2,32}:\d{16,20}>$/.test(s) || (s.length > 0 && s.length <= 12 && !/[A-Za-z0-9\s]/.test(s));
        if (!ok) throw new UserError('Use a single Unicode emoji or a custom emoji like `<:shard:123456789012345678>`.', { title: 'Invalid emoji', tone: 'warning' });
        entries.push([f.path, s]);
      } else if (f.type === 'string') {
        if (s.length < (f.min || 0) || s.length > f.max) throw new UserError(`**${f.label}** must be ${f.min}–${f.max} characters.`, { title: 'Invalid value', tone: 'warning' });
        entries.push([f.path, s]);
      } else if (f.type === 'text') entries.push([f.path, s.slice(0, f.max)]);
    });
    // Cross-field sanity checks.
    const get = (p) => entries.find(([k]) => k === p)?.[1];
    if (get('leveling.chatXpMin') !== undefined && get('leveling.chatXpMin') > get('leveling.chatXpMax')) throw new UserError('Minimum XP cannot exceed maximum XP.', { title: 'Invalid range', tone: 'warning' });
    if (get('leveling.softCap') !== undefined && get('leveling.softCap') > get('leveling.hardCap')) throw new UserError('The soft cap cannot be higher than the hard cap.', { title: 'Invalid caps', tone: 'warning' });
    if (get('events.dropRewardMin') !== undefined && get('events.dropRewardMin') > get('events.dropRewardMax')) throw new UserError('Minimum drop reward cannot exceed the maximum.', { title: 'Invalid range', tone: 'warning' });
    if (get('events.breachWindowStart') !== undefined && get('events.breachWindowStart') >= get('events.breachWindowEnd')) throw new UserError('The breach window must start before it ends.', { title: 'Invalid window', tone: 'warning' });
    return entries;
  }

  function audit(ctx, title, detail) {
    bot.services.audit.log(ctx.guildId, { title: `${ICON.settings} Setup · ${title}`, description: detail, actorId: ctx.userId, color: COLORS.steel }).catch(() => null);
  }

  bot.router.command({
    name: 'setup',
    description: 'Open the Sanctuary Core control panel (Manage Server).',
    defaultMemberPermissions: MANAGE_GUILD,
    async run(ctx) {
      requireManager(ctx);
      await ctx.reply(overview(ctx.guildId));
    },
  });

  bot.router.component('setup', async (ctx, action, a, b) => {
    requireManager(ctx);
    const guildId = ctx.guildId;
    switch (action) {
      case 'nav':
        return ctx.update(RENDER[ctx.values[0]](guildId));
      case 'sec':
        return ctx.update(RENDER[a](guildId));
      case 'edit':
        return ctx.showModal(groupModal(guildId, a));
      case 'toggle': {
        const value = !getPath(bot.settings.get(guildId), a);
        bot.settings.set(guildId, a, value);
        audit(ctx, a, `${value ? 'Enabled' : 'Disabled'}`);
        return ctx.update(leveling(guildId, `> ${value ? '🟢 Enabled' : '⚪ Paused'}.`));
      }
      case 'ch': {
        const value = ctx.values[0] || null;
        bot.settings.set(guildId, a, value);
        audit(ctx, CHANNEL_FIELDS.find(([p]) => p === a)?.[1] || a, value ? `<#${value}>` : 'cleared');
        const warn = value && !canPost(bot.cache, guildId, value, { embeds: true }).ok ? `\n> ⚠️ I can't post in <#${value}> yet — check my permissions there.` : '';
        return ctx.update(channels(guildId, `> ✅ Saved.${warn}`));
      }
      case 'ms': {
        bot.settings.set(guildId, a, [...ctx.values]);
        audit(ctx, a, ctx.values.length ? ctx.values.map((v) => (a.includes('Channel') ? `<#${v}>` : `<@&${v}>`)).join(' ') : 'cleared');
        const back = a.startsWith('events.') ? events : a.startsWith('leveling.') ? multipliers : roles;
        return ctx.update(back(guildId, '> ✅ Saved.'));
      }
      case 'mult':
        return ctx.update(multipliers(guildId));
      case 'cm':
        if (a === 'rm') {
          bot.settings.update(guildId, (s) => { delete s.leveling.channelMultipliers[ctx.values[0]]; });
          return ctx.update(multipliers(guildId, '> Multiplier removed.'));
        }
        return ctx.showModal(modal({
          id: 'setup:cmsave',
          title: 'Channel XP multiplier',
          components: [
            label('Channel or category', channelSelect({ id: 'ch', channelTypes: [ChannelTypes.GuildText, ChannelTypes.GuildAnnouncement, ChannelTypes.GuildVoice, ChannelTypes.GuildCategory, ChannelTypes.GuildForum, ChannelTypes.GuildStage] }), 'Threads inherit their parent channel'),
            label('Multiplier (%)', textInput({ id: 'pct', max: 3, value: '150', placeholder: '0–500' }), '100 = normal · 150 = +50% · 0 = no XP'),
          ],
        }));
      case 'rmult':
        if (a === 'rm') {
          bot.settings.update(guildId, (s) => { delete s.leveling.roleMultipliers[ctx.values[0]]; });
          return ctx.update(multipliers(guildId, '> Multiplier removed.'));
        }
        return ctx.showModal(modal({
          id: 'setup:rmultsave',
          title: 'Role XP multiplier',
          components: [
            label('Role', roleSelect({ id: 'role' }), 'e.g. Server Booster'),
            label('Multiplier (%)', textInput({ id: 'pct', max: 3, value: '110', placeholder: '100–300' }), 'The highest multiplier among a member\'s roles applies'),
          ],
        }));
      case 'rw':
        if (a === 'rm') {
          const level = Number(ctx.values[0]);
          bot.settings.update(guildId, (s) => { s.leveling.rewards = s.leveling.rewards.filter((r) => r.level !== level); });
          audit(ctx, 'Level reward removed', `Level ${level}`);
          return ctx.update(roles(guildId, '> Reward removed.'));
        }
        return ctx.showModal(modal({
          id: 'setup:rwsave',
          title: 'Level reward role',
          components: [
            label('Level', textInput({ id: 'level', max: 3, placeholder: 'e.g. 10' }), 'Members reaching this level get the role'),
            label('Role', roleSelect({ id: 'role' }), 'The bot\'s role must be above it'),
          ],
        }));
      case 'fr': {
        const fr = bot.settings.get(guildId).factions.roleIds || {};
        return ctx.showModal(modal({
          id: 'setup:frsave',
          title: 'Faction roles',
          components: FACTION_KEYS.map((k) => label(`${FACTIONS[k].name} role`, roleSelect({ id: k, min: 0, max: 1, required: false, defaults: [fr[k]].filter(Boolean) }))),
        }));
      }
      case 'inew':
        return ctx.showModal(modal({
          id: 'setup:inewsave',
          title: 'New Supply Depot item',
          components: [
            label('Name', textInput({ id: 'name', max: 80 })),
            label('Type', radioGroup({ id: 'kind', options: Object.entries(ITEM_KINDS).map(([k, v]) => ({ value: k, label: v.label, description: v.hint.slice(0, 100), default: k === 'title' })) })),
            label('Price', textInput({ id: 'price', max: 9, placeholder: 'e.g. 2500' })),
            label('Description', textInput({ id: 'desc', style: TextInputStyle.Paragraph, max: 300, required: false })),
            label('Emoji', textInput({ id: 'emoji', max: 64, required: false, placeholder: 'e.g. 🎴' })),
          ],
        }));
      case 'iedit':
        return ctx.update(itemEditor(guildId, ctx.values[0]));
      case 'itoggle': {
        const item = catalog().get(guildId, a);
        if (item.kind === 'role' && !item.role_id && !item.enabled) throw new UserError('Choose the role (Type settings) before putting this item on sale.', { title: 'Role missing', tone: 'warning' });
        if (item.kind === 'fulfillment' && !item.enabled && !bot.settings.get(guildId).shop.requisitionChannelId) throw new UserError('Set a **Requisition queue** channel (Channels section) before selling in-game rewards.', { title: 'Queue missing', tone: 'warning' });
        catalog().update(guildId, a, { enabled: !item.enabled });
        audit(ctx, `Depot item ${item.enabled ? 'hidden' : 'on sale'}`, item.name);
        return ctx.update(itemEditor(guildId, a, `> ${item.enabled ? 'Hidden from' : 'Now on sale in'} the Supply Depot.`));
      }
      case 'idel':
        if (b !== 'yes') {
          return ctx.update(shell('depot', [text('### 🗑️ Delete this item?\nOwned cosmetics stay with members; purchase history is kept for limits and audits.'), row(button({ id: `setup:idel:${a}:yes`, label: 'Delete item', emoji: '🗑️', style: ButtonStyle.Danger }), button({ id: `setup:iback:${a}`, label: 'Cancel', emoji: ICON.back }))]));
        }
        audit(ctx, 'Depot item deleted', catalog().get(guildId, a)?.name || a);
        catalog().remove(guildId, a);
        return ctx.update(depot(guildId, '> Item deleted.'));
      case 'iback':
        return ctx.update(itemEditor(guildId, a));
      case 'ibasic': {
        const item = catalog().get(guildId, a);
        return ctx.showModal(modal({
          id: `setup:ibasicsave:${a}`,
          title: 'Item details',
          components: [
            label('Name', textInput({ id: 'name', max: 80, value: item.name })),
            label('Price', textInput({ id: 'price', max: 9, value: String(item.price) })),
            label('Description', textInput({ id: 'desc', style: TextInputStyle.Paragraph, max: 300, required: false, value: item.description })),
            label('Emoji', textInput({ id: 'emoji', max: 64, required: false, value: item.emoji })),
            label('Minimum level', textInput({ id: 'level', max: 3, value: String(item.min_level) })),
          ],
        }));
      }
      case 'ilimit': {
        const item = catalog().get(guildId, a);
        const periodOpts = (current) => Object.entries(PERIODS).map(([k, v]) => ({ value: k, label: k === 'none' ? 'No window' : v.replace(/^per /, 'Per ').replace(/^ever$/, 'Lifetime'), default: k === current }));
        return ctx.showModal(modal({
          id: `setup:ilimitsave:${a}`,
          title: 'Limits & stock',
          components: [
            label('Per-member limit', textInput({ id: 'limit', max: 5, required: false, value: item.limit_count ? String(item.limit_count) : '', placeholder: 'blank = unlimited' })),
            label('Limit window', radioGroup({ id: 'lperiod', options: periodOpts(item.limit_period) })),
            label('Stock', textInput({ id: 'stock', max: 6, required: false, value: item.stock === null ? '' : String(item.stock), placeholder: 'blank = unlimited' })),
            label('Stock window', radioGroup({ id: 'speriod', options: periodOpts(item.stock_period) }), 'Stock refills at the start of each window'),
          ],
        }));
      }
      case 'ikind': {
        const item = catalog().get(guildId, a);
        let comps;
        if (item.kind === 'title') comps = [label('Title text', textInput({ id: 'title', max: 40, value: item.data.title || item.name }))];
        else if (item.kind === 'accent') comps = [label('Colour (hex)', textInput({ id: 'color', max: 7, value: `#${Number(item.data.color ?? 0xe5446d).toString(16).padStart(6, '0')}` }), 'e.g. #E5446D')];
        else if (item.kind === 'role') comps = [label('Role', roleSelect({ id: 'role', defaults: [item.role_id].filter(Boolean) })), label('Duration (days)', textInput({ id: 'days', max: 4, required: false, value: item.data.days ? String(item.data.days) : '', placeholder: 'blank = permanent' }))];
        else if (item.kind === 'consumable') {
          comps = [
            label('Effect', radioGroup({ id: 'effect', options: [{ value: 'streak_shield', label: 'Streak Shield', description: 'Protects the airdrop streak for one missed day', default: item.data.effect === 'streak_shield' }, { value: 'xp_boost', label: 'XP booster', default: item.data.effect !== 'streak_shield' }] })),
            label('Booster strength (%)', textInput({ id: 'percent', max: 3, value: String(item.data.percent || 125) }), '125 = +25% XP (110–300)'),
            label('Booster duration (minutes)', textInput({ id: 'minutes', max: 4, value: String(item.data.minutes || 60) }), '5–1440'),
          ];
        } else throw new UserError('This item type has no extra settings.', { title: 'Nothing to edit', tone: 'info' });
        return ctx.showModal(modal({ id: `setup:ikindsave:${a}`, title: `${ITEM_KINDS[item.kind].label} settings`, components: comps }));
      }
      default:
        return undefined;
    }
  });

  function multipliers(guildId, note) {
    const s = bot.settings.get(guildId).leveling;
    const cm = Object.entries(s.channelMultipliers);
    const rm = Object.entries(s.roleMultipliers);
    const parts = [
      text('**XP-blocked channels**\n-# No XP in these channels, their threads or the channels inside these categories'),
      row(channelSelect({ id: 'setup:ms:leveling.noXpChannelIds', placeholder: 'Channels/categories without XP', channelTypes: [ChannelTypes.GuildText, ChannelTypes.GuildAnnouncement, ChannelTypes.GuildVoice, ChannelTypes.GuildCategory, ChannelTypes.GuildForum, ChannelTypes.GuildStage], min: 0, max: 25, defaults: s.noXpChannelIds })),
      text('**XP-blocked roles**\n-# Members with these roles never earn XP (e.g. muted, bots)'),
      row(roleSelect({ id: 'setup:ms:leveling.noXpRoleIds', placeholder: 'Roles without XP', min: 0, max: 25, defaults: s.noXpRoleIds })),
      separator(),
      section(['**Channel multipliers**', cm.length ? cm.map(([id, p]) => `<#${id}> ${p}%`).join(' · ') : '-# None'], button({ id: 'setup:cm:add', label: 'Set', emoji: '➕' })),
    ];
    if (cm.length) parts.push(row(stringSelect({ id: 'setup:cm:rm', placeholder: 'Remove a channel multiplier', options: cm.slice(0, 25).map(([id, p]) => ({ label: `#${bot.cache.channel(guildId, id)?.name || id} — ${p}%`, value: id })) })));
    parts.push(section(['**Role multipliers**', rm.length ? rm.map(([id, p]) => `<@&${id}> ${p}%`).join(' · ') : '-# None'], button({ id: 'setup:rmult:add', label: 'Set', emoji: '➕' })));
    if (rm.length) parts.push(row(stringSelect({ id: 'setup:rmult:rm', placeholder: 'Remove a role multiplier', options: rm.slice(0, 25).map(([id, p]) => ({ label: `@${bot.cache.guild(guildId)?.roles.get(id)?.name || id} — ${p}%`, value: id })) })));
    parts.push(row(button({ id: 'setup:sec:leveling', label: 'Back to leveling', emoji: ICON.back })));
    return shell('leveling', parts, { note });
  }

  bot.router.modal('setup', async (ctx, action, a) => {
    requireManager(ctx);
    const guildId = ctx.guildId;
    switch (action) {
      case 'save': {
        const entries = readGroup(ctx, a);
        const before = bot.settings.get(guildId).leveling.curveScale;
        bot.settings.setMany(guildId, entries);
        let note = `> ✅ **${GROUPS[a].title}** saved.`;
        if (a === 'limits' && bot.settings.get(guildId).leveling.curveScale !== before) {
          const n = bot.services.leveling.recomputeLevels(guildId);
          note += ` Levels recomputed for ${num(n)} Commanders.`;
        }
        audit(ctx, GROUPS[a].title, entries.map(([k, v]) => `\`${k}\` → ${Array.isArray(v) ? v.join(', ') : v}`).join('\n').slice(0, 3500));
        return ctx.update(RENDER[SECTION_OF[a]](guildId, note));
      }
      case 'cmsave':
      case 'rmultsave': {
        const target = action === 'cmsave' ? ctx.field('ch', [])[0] : ctx.field('role', [])[0];
        const pct = Number(String(ctx.field('pct', '')).trim());
        const [min, max] = action === 'cmsave' ? [0, 500] : [100, 300];
        if (!target) throw new UserError('Pick a target.', { title: 'Missing target', tone: 'warning' });
        if (!Number.isInteger(pct) || pct < min || pct > max) throw new UserError(`The multiplier must be a whole number from ${min} to ${max}.`, { title: 'Invalid multiplier', tone: 'warning' });
        bot.settings.update(guildId, (s) => { (action === 'cmsave' ? s.leveling.channelMultipliers : s.leveling.roleMultipliers)[target] = pct; });
        audit(ctx, action === 'cmsave' ? 'Channel multiplier' : 'Role multiplier', `${action === 'cmsave' ? `<#${target}>` : `<@&${target}>`} → ${pct}%`);
        return ctx.update(multipliers(guildId, '> ✅ Multiplier saved.'));
      }
      case 'rwsave': {
        const level = Number(String(ctx.field('level', '')).trim());
        const roleId = ctx.field('role', [])[0];
        if (!Number.isInteger(level) || level < 1 || level > 500) throw new UserError('Level must be between 1 and 500.', { title: 'Invalid level', tone: 'warning' });
        const check = canAssignRole(bot.cache, guildId, roleId);
        bot.settings.update(guildId, (s) => {
          s.leveling.rewards = s.leveling.rewards.filter((r) => r.level !== level && r.roleId !== roleId);
          s.leveling.rewards.push({ level, roleId });
        });
        audit(ctx, 'Level reward', `Level ${level} → <@&${roleId}>`);
        return ctx.update(roles(guildId, `> ✅ Level ${level} now grants <@&${roleId}>.${check.ok ? ' Members who already passed it receive the role on their next level-up, or use `/staff inspect` → Sync.' : `\n> ⚠️ ${check.reason}`}`));
      }
      case 'frsave': {
        const map = {};
        for (const k of FACTION_KEYS) map[k] = ctx.field(k, [])[0] || null;
        bot.settings.set(guildId, 'factions.roleIds', map);
        audit(ctx, 'Faction roles', FACTION_KEYS.map((k) => `${FACTIONS[k].name}: ${map[k] ? `<@&${map[k]}>` : '—'}`).join('\n'));
        return ctx.update(roles(guildId, '> ✅ Faction roles saved. New pledges receive them automatically.'));
      }
      case 'inewsave': {
        const name = String(ctx.field('name', '') || '').trim();
        const kind = ctx.field('kind', 'title');
        const price = Number(String(ctx.field('price', '')).replace(/[,_\s]/g, ''));
        if (!name) throw new UserError('Give the item a name.', { title: 'Missing name', tone: 'warning' });
        if (!ITEM_KINDS[kind]) throw new UserError('Pick an item type.', { title: 'Missing type', tone: 'warning' });
        if (!Number.isInteger(price) || price < 0 || price > 100_000_000) throw new UserError('Price must be a whole number from 0 to 100,000,000.', { title: 'Invalid price', tone: 'warning' });
        const data = kind === 'title' ? { title: name.slice(0, 40) } : kind === 'accent' ? { color: COLORS.primary } : kind === 'consumable' ? { effect: 'xp_boost', percent: 125, minutes: 60 } : {};
        const item = catalog().create(guildId, { kind, name, price, description: String(ctx.field('desc', '') || '').trim(), emoji: String(ctx.field('emoji', '') || '').trim() || ITEM_KINDS[kind].emoji, data, enabled: false });
        audit(ctx, 'Depot item created', `${item.name} (${kind}, ${price})`);
        return ctx.update(itemEditor(guildId, item.id, '> ✅ Item created (hidden). Review its settings, then put it on sale.'));
      }
      case 'ibasicsave': {
        const name = String(ctx.field('name', '') || '').trim();
        const price = Number(String(ctx.field('price', '')).replace(/[,_\s]/g, ''));
        const level = Number(String(ctx.field('level', '0')).trim() || 0);
        if (!name) throw new UserError('The name cannot be empty.', { title: 'Missing name', tone: 'warning' });
        if (!Number.isInteger(price) || price < 0 || price > 100_000_000) throw new UserError('Price must be a whole number from 0 to 100,000,000.', { title: 'Invalid price', tone: 'warning' });
        if (!Number.isInteger(level) || level < 0 || level > 500) throw new UserError('Minimum level must be 0–500.', { title: 'Invalid level', tone: 'warning' });
        catalog().update(guildId, a, { name, price, description: String(ctx.field('desc', '') || '').trim(), emoji: String(ctx.field('emoji', '') || '').trim() || null, min_level: level });
        audit(ctx, 'Depot item edited', name);
        return ctx.update(itemEditor(guildId, a, '> ✅ Details saved.'));
      }
      case 'ilimitsave': {
        const parseOpt = (v, label_) => {
          const s = String(v ?? '').trim();
          if (!s) return null;
          const n = Number(s);
          if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new UserError(`${label_} must be blank or a whole number.`, { title: 'Invalid value', tone: 'warning' });
          return n;
        };
        const limit = parseOpt(ctx.field('limit'), 'Per-member limit');
        const stock = parseOpt(ctx.field('stock'), 'Stock');
        catalog().update(guildId, a, { limit_count: limit || null, limit_period: limit ? ctx.field('lperiod', 'none') : 'none', stock, stock_period: ctx.field('speriod', 'none') });
        audit(ctx, 'Depot limits edited', `item ${a}: limit ${limit ?? '∞'} / stock ${stock ?? '∞'}`);
        return ctx.update(itemEditor(guildId, a, '> ✅ Limits saved.'));
      }
      case 'ikindsave': {
        const item = catalog().get(guildId, a);
        const data = { ...item.data };
        const fields = {};
        if (item.kind === 'title') data.title = String(ctx.field('title', '') || item.name).trim().slice(0, 40);
        if (item.kind === 'accent') {
          const hex = String(ctx.field('color', '')).trim().replace('#', '');
          if (!/^[0-9a-f]{6}$/i.test(hex)) throw new UserError('Use a hex colour like #E5446D.', { title: 'Invalid colour', tone: 'warning' });
          data.color = Number.parseInt(hex, 16);
        }
        if (item.kind === 'role') {
          fields.role_id = ctx.field('role', [])[0] || null;
          const days = String(ctx.field('days', '') || '').trim();
          data.days = days ? Number(days) : null;
          if (days && (!Number.isInteger(data.days) || data.days < 1 || data.days > 3650)) throw new UserError('Duration must be 1–3650 days or blank.', { title: 'Invalid duration', tone: 'warning' });
          const check = canAssignRole(bot.cache, guildId, fields.role_id);
          if (!check.ok) throw new UserError(check.reason, { title: 'Role cannot be assigned', tone: 'warning' });
        }
        if (item.kind === 'consumable') {
          data.effect = ctx.field('effect', 'xp_boost');
          data.percent = Number(String(ctx.field('percent', '125')).trim());
          data.minutes = Number(String(ctx.field('minutes', '60')).trim());
          if (!Number.isInteger(data.percent) || data.percent < 110 || data.percent > 300) throw new UserError('Booster strength must be 110–300%.', { title: 'Invalid strength', tone: 'warning' });
          if (!Number.isInteger(data.minutes) || data.minutes < 5 || data.minutes > 1440) throw new UserError('Booster duration must be 5–1440 minutes.', { title: 'Invalid duration', tone: 'warning' });
        }
        catalog().update(guildId, a, { ...fields, data });
        audit(ctx, 'Depot item type settings', item.name);
        return ctx.update(itemEditor(guildId, a, '> ✅ Saved.'));
      }
      default:
        return undefined;
    }
  });

  bot.services.setupUi = { overview, GROUPS };
}
