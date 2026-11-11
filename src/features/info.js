// Help, lore archive, gift-code board, welcome cards and the (optional) new-member briefing.
import { OptionType } from '../core/interactions.js';
import { button, container, linkButton, row, section, separator, stringSelect, text, thumbnail, v2, ButtonStyle } from '../core/components.js';
import { canPost } from '../core/permissions.js';
import { BRAND, COLORS, ICON, REGIONS, RANKS } from '../content/theme.js';
import { ARCHIVE } from '../content/lore.js';
import { avatarUrl, sanitizeInline } from '../util/format.js';
import { discordTime } from '../util/time.js';
import { isStaff, requireGuild } from './common.js';
import { banner } from '../ui.js';

const OFFICIAL_LINKS = [
  { label: 'Official site', url: 'https://apexgirlsen.neorigin.com/', emoji: '🌐' },
  { label: 'Google Play', url: 'https://play.google.com/store/apps/details?id=com.neorigin.apexgirls', emoji: '▶️' },
  { label: 'App Store', url: 'https://apps.apple.com/app/id6476643375', emoji: '🍎' },
];

const HELP = {
  start: {
    label: 'Getting started', emoji: '🧭',
    body: (cur) => [
      '**Welcome to the Sanctuary, Commander.** Everything you do here — chatting, hanging out in voice, joining events — powers your Commander profile.',
      `• \`/profile\` — your Commander ID card (level, rank, ${cur.name}, badges)\n• \`/daily\` — claim the Supply Airdrop once a day and build a streak\n• \`/quests\` — daily & weekly Directives with bonus rewards\n• \`/help\` — this guide · \`/archive\` — lore & game knowledge`,
      '-# Tip: link your game account from your ID card so in-game rewards reach you fast.',
    ],
  },
  progression: {
    label: 'Levels & ranks', emoji: '🎖️',
    body: () => [
      '**XP** comes from genuine conversation (one XP-earning message per minute), replies and active chats (+bonus), voice time with other Commanders, Directives, events and expeditions. Spam, copy-paste and one-word messages earn nothing.',
      `**Ranks:** ${RANKS.map((r) => `${r.emoji} ${r.name} (Lv ${r.min})`).join(' · ')}`,
      '`/leaderboard` shows the season, lifetime, weekly, wealth, voice and streak ladders. Seasons reset monthly and the top Commanders win prizes.',
    ],
  },
  economy: {
    label: 'Core Shards & Depot', emoji: '💠',
    body: (cur) => [
      `**${cur.emoji} ${cur.name}** are earned from chat, voice, level-ups, \`/daily\`, Directives, events, expeditions and duels.`,
      '`/shop` opens the **Supply Depot**: profile titles, card accents, roles, Streak Shields, XP boosters and staff-fulfilled in-game rewards. In-game rewards create a **requisition** — staff deliver it to your UID and you get a DM.',
      '`/inventory` equips cosmetics, activates boosters and tracks requisitions.',
    ],
  },
  events: {
    label: 'Events & factions', emoji: '🚨',
    body: () => [
      '🚨 **Calamity Breach** — a raid boss: Assault, Devastate or Support; counter its faction for +50% damage.\n📦 **Supply Drops** — crates that appear in busy chats; first Commanders to secure them win shards.\n🔐 **Signal Decryption** — lore trivia; first correct answers win.\n🌊 **Resonance Surge** — limited-time XP multiplier.\n🎁 **Giveaways** — enter with one click.',
      '`/faction` — pledge to 🔥 Inferno, ☣️ Rancor, ⚡ Flare, 🌑 Void or 🌌 Nebula. Your XP earns faction points; the weekly winner\'s active members are rewarded.',
      '`/expedition` — idle runs into the Wildness for salvage and relics · `/duel` — Faction Clash duels.',
    ],
  },
  game: {
    label: 'Game info', emoji: '🎮',
    body: () => [
      `**${REGIONS.global.game}** (Global) and **${REGIONS.sea.game}** (Southeast Asia) by Neorigin Games — a post-apocalyptic idle RPG where you command Stellaris against the Calamity Mechs.`,
      '`/codes` — active gift codes and how to redeem them · `/archive` — world, factions, classes, Echo summons and more.',
    ],
  },
  staff: {
    label: 'Staff tools', emoji: '🛠️',
    body: () => [
      '`/setup` — the control panel: channels, XP rates & caps, voice rules, economy, events, factions, roles, level rewards and the Supply Depot catalogue.',
      '`/staff adjust` · `/staff inspect` · `/staff requisitions` · `/staff event` (breach, drop, trivia, surge) · `/staff codes` · `/staff trivia` · `/staff season` · `/giveaway start|list`',
      '-# Staff commands default to members with **Manage Server**. Admins can extend them to moderator roles under Server Settings → Integrations.',
    ],
  },
};

function renderHelp(bot, guildId, section_ = 'start', { ephemeral = true } = {}) {
  const page = HELP[section_] || HELP.start;
  const cur = bot.settings.currency(guildId);
  return v2([container({ accent: COLORS.primary },
    text(`## ${ICON.signal} ${BRAND.system} · Field manual\n-# ${page.emoji} ${page.label}`),
    separator(),
    text(page.body(cur).join('\n\n')),
    separator(),
    row(stringSelect({ id: 'help:topic', placeholder: 'Choose a topic', options: Object.entries(HELP).map(([k, h]) => ({ label: h.label, value: k, emoji: h.emoji, default: k === section_ })) })),
    row(
      button({ id: 'help:brief:0', label: 'Start briefing', emoji: '🎓', style: ButtonStyle.Primary }),
      button({ id: 'prof:view', label: 'My ID card', emoji: ICON.id }),
      button({ id: 'daily:claim', label: 'Supply Airdrop', emoji: ICON.airdrop }),
    ),
  )], { ephemeral });
}

function renderArchive(key = 'pax') {
  const entry = ARCHIVE.find((a) => a.key === key) || ARCHIVE[0];
  return v2([container({ accent: COLORS.accent },
    text(`## ${ICON.archive} Sanctuary Archive\n-# ${entry.emoji} ${entry.title}`),
    separator(),
    text(entry.body.join('\n\n')),
    separator(),
    row(stringSelect({ id: 'arch:topic', placeholder: 'Browse the archive', options: ARCHIVE.map((a) => ({ label: a.title, value: a.key, emoji: a.emoji, default: a.key === entry.key })) })),
    row(...OFFICIAL_LINKS.map((l) => linkButton(l.label, l.url, l.emoji))),
    text('-# Community summaries written for this server. Official news and art belong to Neorigin Games.'),
  )], { ephemeral: true });
}

const BRIEFING = [
  { title: 'Welcome to the Sanctuary', body: 'You are a **Sanctuary Commander** now. This server runs on a Sanctuary Core — it tracks your activity, rewards you for taking part and hosts community events. This 4-step briefing takes under a minute.' },
  { title: 'Earning XP', body: 'Talk with others: one message a minute can earn XP, and replies or lively conversations earn a bonus. Voice chat with other Commanders also counts. Spam, copy-paste and tiny messages earn nothing — just be yourself.' },
  { title: 'Core Shards & the Depot', body: 'Shards come from level-ups, `/daily`, Directives (`/quests`), events and expeditions. Spend them in the Supply Depot (`/shop`) on profile cosmetics, perks and staff-fulfilled in-game rewards.' },
  { title: 'Events & factions', body: 'Pledge a faction with `/faction` — 🔥 ▸ ☣️ ▸ ⚡ ▸ 🌑 ▸ 🔥, 🌌 neutral. Counters matter in Calamity Breaches, expeditions and duels. Keep an eye out for Supply Drops and trivia in chat!' },
];

function renderBriefing(bot, guildId, step, { note } = {}) {
  const cur = bot.settings.currency(guildId);
  const page = BRIEFING[step];
  const last = step === BRIEFING.length - 1;
  return v2([container({ accent: COLORS.primary },
    text(`## 🎓 Briefing ${step + 1}/${BRIEFING.length} · ${page.title}\n${page.body}${note ? `\n\n${note}` : ''}`),
    separator(),
    row(
      button({ id: `help:brief:${Math.max(0, step - 1)}`, label: 'Back', emoji: ICON.prev, disabled: step === 0 }),
      last
        ? button({ id: 'help:done', label: `Complete (+${cur.emoji} 100)`, emoji: ICON.ok, style: ButtonStyle.Success })
        : button({ id: `help:brief:${step + 1}`, label: 'Next', emoji: ICON.next, style: ButtonStyle.Primary }),
    ),
  )], { ephemeral: true });
}

function renderCodes(bot, guildId) {
  const now = Date.now();
  const rows = bot.db.all('SELECT * FROM codes WHERE guild_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 15', guildId, now);
  const lines = rows.length
    ? rows.map((c) => `${c.region === 'all' ? '🌐' : REGIONS[c.region]?.emoji || '🌐'} \`${sanitizeInline(c.code, 40)}\`${c.rewards ? ` — ${sanitizeInline(c.rewards, 100)}` : ''}${c.expires_at ? `\n-# expires ${discordTime(c.expires_at, 'R')}` : ''}`).join('\n')
    : '*No active codes listed right now. Staff post new ones here as soon as they drop.*';
  return v2([container({ accent: COLORS.gold },
    text(`## ${ICON.code} Gift codes`),
    text(lines),
    separator(),
    text('**How to redeem:** in game, tap your **avatar** (top-left) → **System Settings** → enter the code in the redeem box → **Redeem**. Codes are not case-sensitive.\n-# 🌍 Global (Apex Girls) · 🌏 SEA (Scarlet Girls - Elite Edition) · 🌐 both'),
  )], { ephemeral: true });
}

export default function setup(bot) {
  bot.router.command({
    name: 'help',
    description: 'Field manual: how levels, Core Shards, events and factions work.',
    options: [{ type: OptionType.String, name: 'topic', description: 'Jump to a topic', choices: Object.entries(HELP).map(([k, h]) => ({ name: h.label, value: k })) }],
    async run(ctx) {
      await ctx.reply(renderHelp(bot, requireGuild(ctx), ctx.option('topic') || 'start'));
    },
  });

  bot.router.command({
    name: 'archive',
    description: 'Sanctuary Archive — the world of Apex Girls: Pax, Calamity Mechs, factions and more.',
    options: [{ type: OptionType.String, name: 'topic', description: 'Archive entry', choices: ARCHIVE.map((a) => ({ name: a.title, value: a.key })) }],
    async run(ctx) {
      await ctx.reply(renderArchive(ctx.option('topic') || 'pax'));
    },
  });

  bot.router.command({
    name: 'codes',
    description: 'Active gift codes for Apex Girls / Scarlet Girls and how to redeem them.',
    async run(ctx) {
      await ctx.reply(renderCodes(bot, requireGuild(ctx)));
    },
  });

  const respond = (ctx, payload) => (ctx.message?.flags & 64 ? ctx.update(payload) : ctx.reply(payload));

  bot.router.component('help', async (ctx, action, arg) => {
    const guildId = requireGuild(ctx);
    if (action === 'topic') return respond(ctx, renderHelp(bot, guildId, ctx.values[0]));
    if (action === 'brief') return respond(ctx, renderBriefing(bot, guildId, Math.min(BRIEFING.length - 1, Math.max(0, Number(arg) || 0))));
    if (action === 'faction') return ctx.reply(bot.services.factions.render(guildId, ctx.userId));
    if (action === 'done') {
      const rec = bot.members.ensure(guildId, ctx.userId);
      const cur = bot.settings.currency(guildId);
      let note = '> ✅ Briefing complete. Welcome aboard, Commander!';
      if (!rec.onboarded) {
        bot.members.update(guildId, ctx.userId, { onboarded: 1 });
        bot.economy.credit(guildId, ctx.userId, 100, 'onboarding', { reason: 'Completed the briefing' });
        note = `> ✅ Briefing complete — +${cur.emoji} **100** orientation bonus. Welcome aboard, Commander!`;
      }
      return respond(ctx, renderBriefing(bot, guildId, BRIEFING.length - 1, { note }));
    }
    return undefined;
  });

  bot.router.component('arch', async (ctx) => respond(ctx, renderArchive(ctx.values[0])));

  // ── Welcome cards (requires the GUILD_MEMBERS intent) ─────────────────────
  const joinBuffer = new Map();
  async function flushWelcome(guildId) {
    const buf = joinBuffer.get(guildId);
    joinBuffer.delete(guildId);
    if (!buf?.users.length) return;
    const settings = bot.settings.get(guildId);
    const w = settings.welcome;
    if (!w.enabled || !w.channelId || !canPost(bot.cache, guildId, w.channelId).ok) return;
    const guild = bot.cache.guild(guildId);
    const users = buf.users.slice(0, 20);
    const mentions = users.map((u) => `<@${u.id}>`).join(', ');
    // Staff-written text keeps its markdown/channel links; allowed_mentions still blocks mass pings.
    const message = String(w.message || '').slice(0, 400).replace(/\{user\}/g, mentions) || `Welcome, ${mentions}!`;
    const head = `## ${ICON.signal} New Commander${users.length > 1 ? 's' : ''} detected\n${message}\n-# ${guild ? `${sanitizeInline(guild.name, 60)} · ` : ''}Commander #${guild?.memberCount ?? '—'}`;
    const body = users.length === 1 ? section(head, thumbnail(avatarUrl(users[0], { size: 128 }), 'New Commander')) : text(head);
    await bot.api.send(w.channelId, v2([container({ accent: COLORS.primary },
      banner(settings),
      body,
      row(
        button({ id: 'help:brief:0', label: 'Start briefing', emoji: '🎓', style: ButtonStyle.Primary }),
        button({ id: 'help:faction', label: 'Pledge a faction', emoji: ICON.faction }),
        button({ id: 'daily:claim', label: 'First airdrop', emoji: ICON.airdrop }),
      ),
    )], { mentions: users.map((u) => u.id) })).catch((err) => bot.log.warn(`welcome failed: ${err.message}`));
  }

  bot.on('GUILD_MEMBER_ADD', (d) => {
    if (d.user?.bot) return;
    const w = bot.settings.get(d.guild_id).welcome;
    if (!w.enabled || !w.channelId) return;
    let buf = joinBuffer.get(d.guild_id);
    if (!buf) {
      buf = { users: [] };
      joinBuffer.set(d.guild_id, buf);
      setTimeout(() => flushWelcome(d.guild_id), 8_000);
    }
    buf.users.push(d.user);
  });

  bot.services.info = { renderHelp, renderCodes, isStaff: (ctx) => isStaff(bot, ctx) };
}
