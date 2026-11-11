// /staff — moderation-grade tools: audited adjustments, member inspection, requisition queue,
// event launcher, gift-code board, custom trivia and season control.
import { OptionType, UserError } from '../core/interactions.js';
import { button, container, label, linkButton, modal, radioGroup, row, section, separator, stringSelect, text, textInput, thumbnail, v2, ButtonStyle, ChannelTypes, TextInputStyle } from '../core/components.js';
import { COLORS, FACTIONS, ICON, REGIONS } from '../content/theme.js';
import { levelProgress } from './leveling/curve.js';
import { avatarUrl, displayName, num, sanitizeInline } from '../util/format.js';
import { discordTime, nextMonthReset, parseDuration } from '../util/time.js';
import { intField, requireStaff } from './common.js';
import { success } from '../ui.js';

const MANAGE_GUILD = String(1 << 5);

export default function setup(bot) {
  const ui = {};

  ui.inspect = (guildId, userId, { note } = {}) => {
    const rec = bot.members.ensure(guildId, userId);
    const settings = bot.settings.get(guildId);
    const prog = levelProgress(rec.xp, settings.leveling.curveScale);
    const currency = bot.settings.currency(guildId);
    const cached = bot.cache.member(guildId, userId);
    const name = sanitizeInline(displayName({ username: cached?.username, global_name: cached?.globalName }, { nick: cached?.nick }) || userId, 40);
    const ledger = bot.economy.history(guildId, userId, 10);
    const stats = bot.members.stats(rec);
    const lines = [
      `## ${ICON.staff} Commander record · ${name}`,
      `<@${userId}> \`${userId}\`${rec.left_guild ? ' · ⚠️ left the server' : ''}`,
      `Level **${prog.level}** · ${num(rec.xp)} XP · season ${num(rec.season_xp)} · week ${num(rec.weekly_xp)}`,
      `${currency.long(rec.shards)} (lifetime earned ${num(rec.shards_earned)})`,
      `${ICON.chat} ${num(rec.messages)} msgs · ${ICON.voice} ${Math.floor(rec.voice_minutes / 60)}h · ${ICON.streak} ${rec.streak} (best ${rec.best_streak}) · ${rec.faction ? `${FACTIONS[rec.faction].emoji} ${FACTIONS[rec.faction].name}` : 'no faction'}`,
      `-# Tracked since ${discordTime(rec.created_at, 'D')} · breaches ${stats.breaches || 0} · trivia ${stats.trivia_wins || 0} · drops ${stats.drops || 0} · expeditions ${stats.expeditions || 0}${rec.game_uid ? ` · ${REGIONS[rec.game_region]?.label || 'game'} ${sanitizeInline(rec.game_server || '', 16)} UID \`${sanitizeInline(rec.game_uid, 20)}\`` : ''}`,
    ];
    const parts = [section(lines.join('\n'), thumbnail(avatarUrl({ id: userId, avatar: cached?.avatar }, { size: 128 })))];
    if (note) parts.push(text(note));
    parts.push(separator());
    parts.push(text(`### Recent ledger\n${ledger.length ? ledger.map((l) => `\`${l.delta > 0 ? '+' : ''}${num(l.delta)}${l.currency === 'xp' ? ' XP' : ''}\` ${l.kind}${l.reason ? ` · ${sanitizeInline(l.reason, 60)}` : ''}${l.actor_id ? ` · by <@${l.actor_id}>` : ''} · ${discordTime(l.created_at, 'R')}`).join('\n') : '*No ledger entries yet.*'}`));
    parts.push(row(
      button({ id: `staff:adj:${userId}:shards`, label: 'Adjust shards', emoji: currency.emoji.startsWith('<') ? '💠' : currency.emoji }),
      button({ id: `staff:adj:${userId}:xp`, label: 'Adjust XP', emoji: '✨' }),
      button({ id: `staff:sync:${userId}`, label: 'Sync level roles', emoji: '🔁' }),
      button({ id: `staff:reset:${userId}`, label: 'Reset progress', emoji: '🧹', style: ButtonStyle.Danger }),
    ));
    return v2([container({ accent: COLORS.steel }, ...parts)], { ephemeral: true });
  };

  ui.requisitions = (guildId) => {
    const pending = bot.services.requisitions.pending(guildId, 15);
    const parts = [text(`## ${ICON.requisition} Requisition queue\n-# ${pending.length} pending · handle tickets from the queue channel or the buttons below`)];
    if (!pending.length) parts.push(text('*All caught up — nothing waiting.*'));
    for (const r of pending.slice(0, 8)) {
      const line = `**#${r.id} · ${sanitizeInline(r.title, 60)}**${r.quantity > 1 ? ` ×${r.quantity}` : ''} for <@${r.user_id}>\n-# ${REGIONS[r.region]?.label || '—'} · ${sanitizeInline(r.server || '—', 16)} · UID \`${sanitizeInline(r.uid || '—', 20)}\` · filed ${discordTime(r.created_at, 'R')}`;
      const jump = r.channel_id && r.message_id ? linkButton('Open ticket', `https://discord.com/channels/${guildId}/${r.channel_id}/${r.message_id}`, '🔗') : button({ id: `req:ok:${r.id}`, label: 'Mark fulfilled', emoji: '✅', style: ButtonStyle.Success });
      parts.push(section(line, jump));
    }
    return v2([container({ accent: COLORS.warning }, ...parts)], { ephemeral: true });
  };

  ui.codes = (guildId, { note } = {}) => {
    const rows = bot.db.all('SELECT * FROM codes WHERE guild_id = ? ORDER BY created_at DESC LIMIT 25', guildId);
    const now = Date.now();
    const parts = [text(`## ${ICON.code} Gift-code board\n-# Members see active codes with \`/codes\``)];
    if (note) parts.push(text(note));
    parts.push(text(rows.length ? rows.map((c) => `${c.expires_at && c.expires_at < now ? '⌛' : '✅'} \`${sanitizeInline(c.code, 40)}\` ${REGIONS[c.region]?.emoji || '🌐'}${c.rewards ? ` — ${sanitizeInline(c.rewards, 80)}` : ''}${c.expires_at ? ` · ${c.expires_at < now ? 'expired' : 'expires'} ${discordTime(c.expires_at, 'R')}` : ''}`).join('\n') : '*No codes yet.*'));
    parts.push(row(
      button({ id: 'staff:codeadd', label: 'Add code', emoji: '➕', style: ButtonStyle.Success }),
      button({ id: 'staff:codepost', label: 'Post board here', emoji: '📣', disabled: !rows.length }),
      button({ id: 'staff:codeprune', label: 'Remove expired', emoji: '🧹', disabled: !rows.some((c) => c.expires_at && c.expires_at < now) }),
    ));
    if (rows.length) parts.push(row(stringSelect({ id: 'staff:coderm', placeholder: 'Remove a code', options: rows.map((c) => ({ label: c.code.slice(0, 100), value: String(c.id), description: (c.rewards || '').slice(0, 100) || undefined })) })));
    return v2([container({ accent: COLORS.gold }, ...parts)], { ephemeral: true });
  };

  ui.trivia = (guildId, { note } = {}) => {
    const rows = bot.db.all('SELECT * FROM trivia WHERE guild_id = ? ORDER BY id DESC LIMIT 25', guildId);
    const parts = [text(`## ${ICON.trivia} Custom trivia\n-# ${rows.length} custom question${rows.length === 1 ? '' : 's'} mixed in with the built-in lore bank`)];
    if (note) parts.push(text(note));
    if (rows.length) parts.push(text(rows.slice(0, 10).map((t) => `• ${sanitizeInline(t.question, 120)} — ✅ ${sanitizeInline(JSON.parse(t.answers)[t.correct], 40)}`).join('\n')));
    parts.push(row(button({ id: 'staff:trivadd', label: 'Add question', emoji: '➕', style: ButtonStyle.Success })));
    if (rows.length) parts.push(row(stringSelect({ id: 'staff:trivrm', placeholder: 'Delete a question', options: rows.map((t) => ({ label: t.question.slice(0, 100), value: String(t.id) })) })));
    return v2([container({ accent: COLORS.info }, ...parts)], { ephemeral: true });
  };

  ui.season = (guildId) => {
    const settings = bot.settings.get(guildId);
    const state = bot.state.get(guildId);
    const top = bot.members.top(guildId, 'season_xp', 3);
    const currency = bot.settings.currency(guildId);
    return v2([container({ accent: COLORS.gold },
      text(`## ${ICON.season} Season ${state.season_no}\nStarted ${discordTime(state.season_started_at || Date.now(), 'D')} · ends automatically ${discordTime(nextMonthReset(Date.now(), settings.general.resetHour), 'R')}\nPrizes: ${settings.seasons.enabled ? settings.seasons.rewards.map((r, i) => `#${i + 1} ${currency.emoji}${num(r)}`).join(' · ') : 'seasons disabled'}`),
      text(top.length ? top.map((m, i) => `${['🥇', '🥈', '🥉'][i]} <@${m.user_id}> — ${num(m.season_xp)} XP`).join('\n') : '*No season XP yet.*'),
      row(button({ id: 'staff:seasonend', label: 'End season now', emoji: '🏁', style: ButtonStyle.Danger })),
    )], { ephemeral: true });
  };

  bot.router.command({
    name: 'staff',
    description: 'Staff tools: adjustments, member records, requisitions, events, codes and seasons.',
    defaultMemberPermissions: MANAGE_GUILD,
    options: [
      {
        type: OptionType.Subcommand, name: 'adjust', description: 'Add or remove XP or Core Shards (audited).',
        options: [
          { type: OptionType.User, name: 'member', description: 'Commander', required: true },
          { type: OptionType.String, name: 'currency', description: 'What to adjust', required: true, choices: [{ name: 'Core Shards', value: 'shards' }, { name: 'XP', value: 'xp' }] },
          { type: OptionType.Integer, name: 'amount', description: 'Positive to add, negative to remove', required: true, min_value: -10_000_000, max_value: 10_000_000 },
          { type: OptionType.String, name: 'reason', description: 'Shown in the audit log', required: true, max_length: 200 },
        ],
      },
      { type: OptionType.Subcommand, name: 'inspect', description: 'Full record of a Commander with quick actions.', options: [{ type: OptionType.User, name: 'member', description: 'Commander', required: true }] },
      { type: OptionType.Subcommand, name: 'requisitions', description: 'Pending in-game reward requisitions.' },
      {
        type: OptionType.Subcommand, name: 'event', description: 'Launch a community event now.',
        options: [
          { type: OptionType.String, name: 'type', description: 'Event type', required: true, choices: [{ name: 'Calamity Breach (raid boss)', value: 'breach' }, { name: 'Supply Drop', value: 'drop' }, { name: 'Signal Decryption (trivia)', value: 'trivia' }, { name: 'Resonance Surge (XP multiplier)', value: 'surge' }] },
          { type: OptionType.Channel, name: 'channel', description: 'Where to run it (default: this channel)', channel_types: [ChannelTypes.GuildText, ChannelTypes.GuildAnnouncement, ChannelTypes.PublicThread] },
          { type: OptionType.Boolean, name: 'elite', description: 'Breach: double HP and double rewards' },
          { type: OptionType.Integer, name: 'percent', description: 'Surge: XP multiplier in % (e.g. 150 = ×1.5)', min_value: 110, max_value: 300 },
          { type: OptionType.Integer, name: 'minutes', description: 'Breach/Surge duration in minutes', min_value: 5, max_value: 720 },
        ],
      },
      { type: OptionType.Subcommand, name: 'codes', description: 'Manage the gift-code board.' },
      { type: OptionType.Subcommand, name: 'trivia', description: 'Add or remove custom trivia questions.' },
      { type: OptionType.Subcommand, name: 'season', description: 'Season status and manual season end.' },
    ],
    async run(ctx) {
      requireStaff(bot, ctx);
      const guildId = ctx.guildId;
      switch (ctx.subcommand) {
        case 'adjust': {
          const target = ctx.optionUser('member');
          if (target.user?.bot) throw new UserError('Bots have no Commander record.', { title: 'Invalid member', tone: 'warning' });
          const amount = ctx.option('amount');
          const reason = ctx.option('reason');
          const note = applyAdjust(guildId, target.id, ctx.option('currency'), amount, reason, ctx.userId);
          return ctx.reply(ui.inspect(guildId, target.id, { note }));
        }
        case 'inspect': {
          const target = ctx.optionUser('member');
          if (target.user) bot.cache.rememberMember(guildId, target.user, target.member);
          return ctx.reply(ui.inspect(guildId, target.id));
        }
        case 'requisitions':
          return ctx.reply(ui.requisitions(guildId));
        case 'event':
          return launchEvent(ctx);
        case 'codes':
          return ctx.reply(ui.codes(guildId));
        case 'trivia':
          return ctx.reply(ui.trivia(guildId));
        case 'season':
          return ctx.reply(ui.season(guildId));
        default:
          return undefined;
      }
    },
  });

  function applyAdjust(guildId, userId, currency, amount, reason, actorId) {
    const cur = bot.settings.currency(guildId);
    let note;
    if (currency === 'xp') {
      const r = bot.services.leveling.addXp(guildId, userId, amount, { source: 'admin', log: true, actor: actorId, reason });
      note = `> ${ICON.xp} XP ${r.delta >= 0 ? '+' : ''}${num(r.delta)} → ${num(r.xp)} XP (level ${r.before} → ${r.after})`;
      if (r.after < r.before) bot.services.leveling.syncRewardRoles(guildId, userId, r.after).catch(() => null);
    } else {
      const r = bot.economy.adjust(guildId, userId, amount, { reason, actor: actorId });
      note = `> ${cur.emoji} ${r.applied >= 0 ? '+' : ''}${num(r.applied)} → balance ${num(r.balance)}`;
    }
    bot.services.audit.log(guildId, { title: `${ICON.staff} Manual ${currency === 'xp' ? 'XP' : cur.name} adjustment`, userId, actorId, color: amount >= 0 ? COLORS.success : COLORS.danger, fields: [{ name: 'Amount', value: num(amount) }, { name: 'Reason', value: reason, inline: false }] });
    return note;
  }

  async function launchEvent(ctx) {
    const guildId = ctx.guildId;
    const type = ctx.option('type');
    const channelId = ctx.option('channel') || ctx.channelId;
    const events = bot.services.events;
    let msg;
    if (type === 'breach') msg = await events.startBreach(guildId, channelId, { by: ctx.userId, elite: ctx.option('elite', false), minutes: ctx.option('minutes') });
    else if (type === 'drop') msg = await events.startDrop(guildId, channelId, { by: ctx.userId });
    else if (type === 'trivia') msg = await events.startTrivia(guildId, channelId, { by: ctx.userId });
    else if (type === 'surge') {
      const percent = ctx.option('percent', 150);
      const minutes = ctx.option('minutes', 60);
      const until = await events.startSurge(guildId, { by: ctx.userId, percent, minutes, channelId: ctx.option('channel') });
      await bot.services.audit.log(guildId, { title: `${ICON.surge} Resonance Surge ×${percent / 100}`, actorId: ctx.userId, color: COLORS.info, fields: [{ name: 'Until', value: discordTime(until, 'f') }] });
      return ctx.reply(success('Surge engaged', `All XP ×${percent / 100} until ${discordTime(until, 't')}.`));
    }
    await bot.services.audit.log(guildId, { title: `${ICON.breach} Event launched: ${type}`, actorId: ctx.userId, color: COLORS.info, fields: [{ name: 'Channel', value: `<#${channelId}>` }] });
    return ctx.reply(success('Event launched', `Your ${type === 'breach' ? 'Calamity Breach' : type === 'drop' ? 'Supply Drop' : 'Signal Decryption'} is live${msg?.message_id ? `: https://discord.com/channels/${guildId}/${channelId}/${msg.message_id}` : '.'}`));
  }

  bot.router.component('staff', async (ctx, action, a, b) => {
    requireStaff(bot, ctx);
    const guildId = ctx.guildId;
    switch (action) {
      case 'adj':
        return ctx.showModal(modal({
          id: `staff:adjsave:${a}:${b}`,
          title: b === 'xp' ? 'Adjust XP' : 'Adjust Core Shards',
          components: [
            label('Amount', textInput({ id: 'amount', max: 9, placeholder: 'e.g. 500 or -200' }), 'Positive adds, negative removes'),
            label('Reason', textInput({ id: 'reason', max: 200, placeholder: 'Shown in the audit log' })),
          ],
        }));
      case 'sync': {
        const rec = bot.members.ensure(guildId, a);
        const granted = await bot.services.leveling.syncRewardRoles(guildId, a, rec.level);
        return ctx.update(ui.inspect(guildId, a, { note: granted.length ? `> 🔁 Granted ${granted.map((r) => `<@&${r}>`).join(' ')}` : '> 🔁 Level roles already in sync (or none configured).' }));
      }
      case 'reset':
        return ctx.update(v2([container({ accent: COLORS.danger },
          text(`### 🧹 Reset <@${a}>'s progress?\nLifetime XP, level, season & weekly XP and the airdrop streak go back to zero. Core Shards and inventory are kept. This cannot be undone.`),
          row(button({ id: `staff:resetok:${a}`, label: 'Reset progress', emoji: '🧹', style: ButtonStyle.Danger }), button({ id: `staff:back:${a}`, label: 'Cancel', emoji: ICON.back })),
        )], { ephemeral: true }));
      case 'resetok': {
        bot.members.update(guildId, a, { xp: 0, level: 0, season_xp: 0, weekly_xp: 0, streak: 0 });
        bot.economy.logXp(guildId, a, 0, 0, 'admin', { actor: ctx.userId, reason: 'Progress reset' });
        await bot.services.audit.log(guildId, { title: '🧹 Progress reset', userId: a, actorId: ctx.userId, color: COLORS.danger });
        return ctx.update(ui.inspect(guildId, a, { note: '> 🧹 Progress reset.' }));
      }
      case 'back':
        return ctx.update(ui.inspect(guildId, a));
      case 'codeadd':
        return ctx.showModal(modal({
          id: 'staff:codesave',
          title: 'Add a gift code',
          components: [
            label('Code', textInput({ id: 'code', max: 40, placeholder: 'e.g. AGM134' })),
            label('Rewards', textInput({ id: 'rewards', max: 120, required: false, placeholder: 'e.g. 300 Diamonds, 5 Echo Permits' })),
            label('Expires in', textInput({ id: 'expires', max: 10, required: false, placeholder: 'e.g. 7d (blank = no expiry)' })),
            label('Game version', radioGroup({ id: 'region', options: [{ value: 'all', label: 'Both versions', default: true }, { value: 'global', label: 'Global — Apex Girls' }, { value: 'sea', label: 'SEA — Scarlet Girls - Elite Edition' }] })),
          ],
        }));
      case 'codepost':
        await bot.api.send(ctx.channelId, { ...bot.services.info.renderCodes(bot, guildId), flags: 1 << 15 }).catch((err) => { throw new UserError(`Could not post here: ${err.apiMessage || err.message}`); });
        return ctx.update(ui.codes(guildId, { note: '> 📣 Code board posted.' }));
      case 'codeprune':
        bot.db.run('DELETE FROM codes WHERE guild_id = ? AND expires_at IS NOT NULL AND expires_at < ?', guildId, Date.now());
        return ctx.update(ui.codes(guildId, { note: '> 🧹 Expired codes removed.' }));
      case 'coderm':
        bot.db.run('DELETE FROM codes WHERE guild_id = ? AND id = ?', guildId, Number(ctx.values[0]));
        return ctx.update(ui.codes(guildId, { note: '> Code removed.' }));
      case 'trivadd':
        return ctx.showModal(modal({
          id: 'staff:trivsave',
          title: 'Add a trivia question',
          components: [
            label('Question', textInput({ id: 'q', style: TextInputStyle.Paragraph, max: 250 })),
            label('Correct answer', textInput({ id: 'a0', max: 60 }), 'Answers are shuffled when shown'),
            label('Wrong answer 1', textInput({ id: 'a1', max: 60 })),
            label('Wrong answer 2', textInput({ id: 'a2', max: 60 })),
            label('Wrong answer 3', textInput({ id: 'a3', max: 60 })),
          ],
        }));
      case 'trivrm':
        bot.db.run('DELETE FROM trivia WHERE guild_id = ? AND id = ?', guildId, Number(ctx.values[0]));
        return ctx.update(ui.trivia(guildId, { note: '> Question deleted.' }));
      case 'seasonend':
        if (b !== 'yes') {
          return ctx.update(v2([container({ accent: COLORS.danger },
            text('### 🏁 End the season now?\nPrizes are paid to the current top 10, results are announced and season XP resets for everyone.'),
            row(button({ id: 'staff:seasonend:x:yes', label: 'End season', emoji: '🏁', style: ButtonStyle.Danger })),
          )], { ephemeral: true }));
        }
        await bot.services.seasons.endSeason(guildId, { by: ctx.userId });
        return ctx.update(ui.season(guildId));
      default:
        return undefined;
    }
  });

  bot.router.modal('staff', async (ctx, action, a, b) => {
    requireStaff(bot, ctx);
    const guildId = ctx.guildId;
    if (action === 'adjsave') {
      const amount = intField(ctx, 'amount', 'Amount', -10_000_000, 10_000_000);
      const reason = String(ctx.field('reason', '') || '').trim() || 'No reason given';
      const note = applyAdjust(guildId, a, b, amount, reason, ctx.userId);
      return ctx.update(ui.inspect(guildId, a, { note }));
    }
    if (action === 'codesave') {
      const code = String(ctx.field('code', '') || '').trim();
      if (!/^[\w-]{3,40}$/.test(code)) throw new UserError('Codes may contain letters, numbers, _ and - (3–40 characters).', { title: 'Invalid code', tone: 'warning' });
      const expiresRaw = String(ctx.field('expires', '') || '').trim();
      const ms = expiresRaw ? parseDuration(expiresRaw) : null;
      if (expiresRaw && !ms) throw new UserError('Use a duration like `7d` or `36h`, or leave it blank.', { title: 'Invalid expiry', tone: 'warning' });
      bot.db.run('INSERT INTO codes (guild_id, code, rewards, region, expires_at, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', guildId, code, String(ctx.field('rewards', '') || '').trim() || null, ctx.field('region', 'all'), ms ? Date.now() + ms : null, ctx.userId, Date.now());
      return ctx.update(ui.codes(guildId, { note: `> ✅ Added \`${sanitizeInline(code, 40)}\`.` }));
    }
    if (action === 'trivsave') {
      const q = String(ctx.field('q', '') || '').trim();
      const answers = ['a0', 'a1', 'a2', 'a3'].map((k) => String(ctx.field(k, '') || '').trim());
      if (!q || answers.some((x) => !x)) throw new UserError('Fill in the question and all four answers.', { title: 'Incomplete question', tone: 'warning' });
      if (new Set(answers.map((x) => x.toLowerCase())).size !== 4) throw new UserError('All four answers must be different.', { title: 'Duplicate answers', tone: 'warning' });
      bot.db.run('INSERT INTO trivia (guild_id, question, answers, correct, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?)', guildId, q, JSON.stringify(answers), ctx.userId, Date.now());
      return ctx.update(ui.trivia(guildId, { note: '> ✅ Question added to the rotation.' }));
    }
    return undefined;
  });

  bot.services.staffUi = ui;
}

