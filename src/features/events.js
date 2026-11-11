// Community events: Calamity Breach (raid boss), Supply Drops (first-come crates),
// Signal Decryption (lore trivia) and Resonance Surge (temporary XP multiplier).
import { UserError } from '../core/interactions.js';
import { button, container, row, separator, text, v2, ButtonStyle } from '../core/components.js';
import { canPost } from '../core/permissions.js';
import { COLORS, FACTIONS, ICON, counterOf, matchup } from '../content/theme.js';
import { BREACH_MECHS, TRIVIA } from '../content/lore.js';
import { chance, pick, randInt, sample } from '../util/random.js';
import { dayKey, discordTime, snowflakeTime, DAY, MINUTE } from '../util/time.js';
import { bar, num, sanitizeInline } from '../util/format.js';
import { levelFor } from './leveling/curve.js';
import { requireGuild } from './common.js';

const ACTIONS = {
  a: { key: 'a', name: 'Assault', emoji: '⚔️', cooldown: 60_000, roll: () => randInt(80, 140) },
  d: { key: 'd', name: 'Devastate', emoji: '💥', cooldown: 120_000, roll: () => randInt(40, 320) },
  s: { key: 's', name: 'Support', emoji: '🩹', cooldown: 90_000, roll: () => 0 },
};
const RALLY_MS = 3 * MINUTE;
const MIN_ACCOUNT_AGE = 7 * DAY;

export class Events {
  constructor(bot) {
    this.bot = bot;
    this.log = bot.log.child('events');
    this.renderTimers = new Map();
  }

  get db() {
    return this.bot.db;
  }

  get(id) {
    const row = this.db.get('SELECT * FROM events WHERE id = ?', Number(id));
    return row ? { ...row, state: JSON.parse(row.state || '{}') } : null;
  }

  active(guildId, kind) {
    return this.db.all("SELECT * FROM events WHERE guild_id = ? AND kind = ? AND status = 'active' ORDER BY id DESC", guildId, kind).map((r) => ({ ...r, state: JSON.parse(r.state || '{}') }));
  }

  saveState(ev) {
    this.db.run('UPDATE events SET state = ? WHERE id = ?', JSON.stringify(ev.state), ev.id);
  }

  participant(eventId, userId) {
    const p = this.db.get('SELECT * FROM event_participants WHERE event_id = ? AND user_id = ?', eventId, userId);
    return p ? { ...p, data: JSON.parse(p.data || '{}') } : null;
  }

  participants(eventId) {
    return this.db.all('SELECT * FROM event_participants WHERE event_id = ? ORDER BY score DESC', eventId).map((p) => ({ ...p, data: JSON.parse(p.data || '{}') }));
  }

  upsertParticipant(eventId, userId, { score = 0, data = {}, at = Date.now() }) {
    this.db.run(
      `INSERT INTO event_participants (event_id, user_id, score, actions, data, last_action_at) VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET score = score + excluded.score, actions = actions + 1, data = excluded.data, last_action_at = excluded.last_action_at`,
      eventId, userId, score, JSON.stringify(data), at,
    );
  }

  #create(guildId, kind, channelId, state, endsAt, startedBy) {
    const now = Date.now();
    const res = this.db.run('INSERT INTO events (guild_id, kind, status, channel_id, state, started_by, starts_at, ends_at, created_at) VALUES (?, ?, \'active\', ?, ?, ?, ?, ?, ?)', guildId, kind, channelId, JSON.stringify(state), startedBy || null, now, endsAt, now);
    const id = Number(res.lastInsertRowid);
    this.bot.scheduler.schedule(`event:${id}`, 'event.end', endsAt, { id });
    return this.get(id);
  }

  async #post(ev) {
    const msg = await this.bot.api.send(ev.channel_id, this.render(ev));
    this.db.run('UPDATE events SET message_id = ? WHERE id = ?', msg.id, ev.id);
    ev.message_id = msg.id;
    return ev;
  }

  /** Debounced message refresh so busy events stay within edit rate limits. */
  scheduleRender(id, delay = 2_500) {
    if (this.renderTimers.has(id)) return;
    this.renderTimers.set(id, setTimeout(async () => {
      this.renderTimers.delete(id);
      const ev = this.get(id);
      if (!ev?.message_id) return;
      await this.bot.api.edit(ev.channel_id, ev.message_id, this.render(ev)).catch((err) => this.log.debug(`event render failed: ${err.message}`));
    }, delay));
  }

  render(ev) {
    switch (ev.kind) {
      case 'breach': return this.#renderBreach(ev);
      case 'drop': return this.#renderDrop(ev);
      case 'trivia': return this.#renderTrivia(ev);
      default: return v2([text('Unknown event')]);
    }
  }

  ensureChannel(guildId, channelId) {
    const check = canPost(this.bot.cache, guildId, channelId);
    if (!check.ok) throw new UserError(`I can't post in <#${channelId}> (missing ${check.missing.join(', ')}).`, { title: 'Missing permissions' });
  }

  // ── Supply Drop ──────────────────────────────────────────────────────────
  async startDrop(guildId, channelId, { by = null, auto = false } = {}) {
    const s = this.bot.settings.get(guildId).events;
    this.ensureChannel(guildId, channelId);
    if (this.active(guildId, 'drop').some((e) => e.channel_id === channelId)) throw new UserError('A supply drop is already waiting in that channel.', { title: 'Drop in progress', tone: 'warning' });
    const ev = this.#create(guildId, 'drop', channelId, { claimers: s.dropClaimers, reward: [s.dropRewardMin, s.dropRewardMax], minLevel: s.dropMinLevel, claimed: [], auto }, Date.now() + 3 * MINUTE, by);
    const state = this.bot.state.get(guildId);
    const today = dayKey(Date.now(), this.bot.settings.get(guildId).general.resetHour);
    this.bot.state.update(guildId, { last_drop_at: Date.now(), drops_day: today, drops_count: state.drops_day === today ? state.drops_count + 1 : 1 });
    return this.#post(ev);
  }

  #renderDrop(ev) {
    const currency = this.bot.settings.currency(ev.guild_id);
    const { claimers, reward, minLevel, claimed } = ev.state;
    const ended = ev.status !== 'active';
    const lines = [
      `## ${ICON.airdrop} ${ended ? 'Supply crate emptied' : 'Supply Airdrop inbound!'}`,
      ended
        ? claimed.length ? `The crate was secured by ${claimed.length} Commander${claimed.length === 1 ? '' : 's'}.` : 'Nobody reached the crate before the signal faded.'
        : `A Sanctuary Core beacon is pinging an unclaimed crate. The first **${claimers}** Commanders to secure it each get ${currency.emoji} **${reward[0]}–${reward[1]}**.`,
      `-# ${ended ? 'Closed' : `Signal fades ${discordTime(ev.ends_at, 'R')}`}${minLevel ? ` · level ${minLevel}+` : ''} · ${claimed.length}/${claimers} claimed`,
    ];
    if (claimed.length) lines.push(claimed.map((c) => `✅ <@${c.userId}> +${c.amount}`).join(' · '));
    return v2([container({ accent: ended ? COLORS.steel : COLORS.gold },
      text(lines.join('\n')),
      row(button({ id: `drop:claim:${ev.id}`, label: ended ? 'Crate empty' : 'Secure supplies', emoji: ICON.airdrop, style: ButtonStyle.Success, disabled: ended })),
    )]);
  }

  claimDrop(ev, userId) {
    const { state } = ev;
    if (ev.status !== 'active' || Date.now() > ev.ends_at) throw new UserError('The signal has faded — this crate is gone.', { title: 'Too late', tone: 'warning' });
    if (state.claimed.some((c) => c.userId === userId)) throw new UserError('You already grabbed a share of this crate.', { title: 'Already secured', tone: 'warning' });
    if (Date.now() - snowflakeTime(userId) < MIN_ACCOUNT_AGE) throw new UserError('Supply crates need a Discord account older than 7 days.', { title: 'Not eligible', tone: 'warning' });
    const rec = this.bot.members.ensure(ev.guild_id, userId);
    const level = levelFor(rec.xp, this.bot.settings.get(ev.guild_id).leveling.curveScale);
    if (level < state.minLevel) throw new UserError(`Supply crates require level ${state.minLevel}. Chat a little to reach it!`, { title: 'Level too low', tone: 'warning' });
    if (state.claimed.length >= state.claimers) throw new UserError('Someone beat you to the last share!', { title: 'Crate empty', tone: 'warning' });
    const amount = randInt(state.reward[0], state.reward[1]);
    this.db.tx(() => {
      state.claimed.push({ userId, amount });
      this.saveState(ev);
      this.upsertParticipant(ev.id, userId, { score: amount });
      this.bot.economy.credit(ev.guild_id, userId, amount, 'event', { reason: 'Supply drop', ref: ev.id });
    });
    this.bot.members.bumpStat(ev.guild_id, userId, 'drops');
    this.bot.activity({ type: 'event', guildId: ev.guild_id, userId, key: `drop:${ev.id}` });
    return { amount, full: state.claimed.length >= state.claimers };
  }

  /** Called for every XP-earning message: maybe spawn an automatic supply drop. */
  async maybeAutoDrop(evt) {
    const settings = this.bot.settings.get(evt.guildId);
    const s = settings.events;
    if (!s.dropsEnabled || !s.dropChannelIds.length || !evt.lineage?.some((id) => s.dropChannelIds.includes(id))) return;
    const st = this.bot.state.get(evt.guildId);
    const today = dayKey(Date.now(), settings.general.resetHour);
    if (Date.now() - st.last_drop_at < s.dropCooldownMin * MINUTE) return;
    if (st.drops_day === today && st.drops_count >= s.dropMaxPerDay) return;
    const recent = this.bot.services.leveling.channelActivity.get(evt.channelId) || [];
    const speakers = new Set(recent.filter((e) => Date.now() - e.ts < 10 * MINUTE).map((e) => e.userId));
    if (speakers.size < 3) return;
    if (!chance(s.dropChancePermille / 1000)) return;
    if (!canPost(this.bot.cache, evt.guildId, evt.channelId).ok) return;
    await this.startDrop(evt.guildId, evt.channelId, { auto: true }).catch((err) => this.log.debug(`auto drop skipped: ${err.message}`));
  }

  // ── Signal Decryption (trivia) ───────────────────────────────────────────
  async startTrivia(guildId, channelId, { by = null } = {}) {
    const s = this.bot.settings.get(guildId).events;
    this.ensureChannel(guildId, channelId);
    if (this.active(guildId, 'trivia').some((e) => e.channel_id === channelId)) throw new UserError('A transmission is already being decoded in that channel.', { title: 'Trivia in progress', tone: 'warning' });
    const custom = this.db.all('SELECT * FROM trivia WHERE guild_id = ?', guildId).map((t) => ({ q: t.question, answers: JSON.parse(t.answers), correct: t.correct }));
    const recentQs = this.bot.db.kvGet(`trivia.recent.${guildId}`, []);
    const pool = [...TRIVIA, ...custom].filter((t) => !recentQs.includes(t.q));
    const question = pick(pool.length ? pool : [...TRIVIA, ...custom]);
    this.bot.db.kvSet(`trivia.recent.${guildId}`, [question.q, ...recentQs].slice(0, 15));
    const order = sample(question.answers.map((_, i) => i), question.answers.length);
    const ev = this.#create(guildId, 'trivia', channelId, { q: question.q, answers: question.answers, correct: question.correct, order, answered: {}, winners: [], rewardFirst: s.triviaRewardFirst, rewardOthers: s.triviaRewardOthers, maxWinners: s.triviaWinners }, Date.now() + s.triviaSeconds * 1000, by);
    return this.#post(ev);
  }

  #renderTrivia(ev) {
    const currency = this.bot.settings.currency(ev.guild_id);
    const st = ev.state;
    const ended = ev.status !== 'active';
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const lines = [
      `## ${ICON.trivia} Signal Decryption`,
      ended ? `Transmission closed. The decoded answer was **${sanitizeInline(st.answers[st.correct], 80)}**.` : 'An encrypted transmission is coming through. Decode it, Commander:',
      `> **${sanitizeInline(st.q, 300)}**`,
      `-# ${ended ? `${Object.keys(st.answered).length} answers received` : `First correct answer earns ${currency.emoji} ${st.rewardFirst}${st.maxWinners > 1 ? ` · next ${st.maxWinners - 1} earn ${currency.emoji} ${st.rewardOthers}` : ''} · one guess each · closes ${discordTime(ev.ends_at, 'R')}`}`,
    ];
    if (st.winners.length) lines.push(`🔓 Decoded by ${st.winners.map((w, i) => `${i === 0 ? '🥇 ' : ''}<@${w.userId}>`).join(', ')}`);
    else if (ended) lines.push('Nobody cracked it this time.');
    return v2([container({ accent: ended ? COLORS.steel : COLORS.info },
      text(lines.join('\n')),
      row(...st.order.map((answerIndex, pos) => button({
        id: `triv:ans:${ev.id}:${answerIndex}`,
        label: `${letters[pos]} · ${st.answers[answerIndex]}`.slice(0, 80),
        style: ended ? (answerIndex === st.correct ? ButtonStyle.Success : ButtonStyle.Secondary) : ButtonStyle.Primary,
        disabled: ended,
      }))),
    )]);
  }

  answerTrivia(ev, userId, choice) {
    const st = ev.state;
    if (ev.status !== 'active' || Date.now() > ev.ends_at) throw new UserError('That transmission already closed.', { title: 'Too late', tone: 'warning' });
    if (st.answered[userId] !== undefined) throw new UserError('You already transmitted an answer for this signal.', { title: 'One guess only', tone: 'warning' });
    const correct = Number(choice) === st.correct;
    let reward = 0;
    this.db.tx(() => {
      st.answered[userId] = Number(choice);
      if (correct && st.winners.length < st.maxWinners) {
        reward = st.winners.length === 0 ? st.rewardFirst : st.rewardOthers;
        st.winners.push({ userId, amount: reward });
        this.bot.economy.credit(ev.guild_id, userId, reward, 'event', { reason: 'Signal Decryption', ref: ev.id });
      }
      this.saveState(ev);
      this.upsertParticipant(ev.id, userId, { score: reward });
    });
    if (reward) {
      this.bot.members.bumpStat(ev.guild_id, userId, 'trivia_wins');
      this.bot.activity({ type: 'trivia', guildId: ev.guild_id, userId });
    }
    this.bot.activity({ type: 'event', guildId: ev.guild_id, userId, key: `trivia:${ev.id}` });
    return { correct, reward, done: st.winners.length >= st.maxWinners };
  }

  // ── Calamity Breach ──────────────────────────────────────────────────────
  async startBreach(guildId, channelId, { by = null, elite = false, minutes = null } = {}) {
    const s = this.bot.settings.get(guildId).events;
    this.ensureChannel(guildId, channelId);
    if (this.active(guildId, 'breach').length) throw new UserError('A Calamity Breach is already in progress.', { title: 'Breach active', tone: 'warning' });
    const active = this.db.get('SELECT COUNT(*) AS n FROM members WHERE guild_id = ? AND weekly_xp > 0 AND left_guild = 0', guildId).n;
    const expected = Math.max(4, Math.round(active * 0.3));
    const maxHp = Math.round((expected * 1_000 * (elite ? 2 : 1)) / 100) * 100;
    const mech = pick(BREACH_MECHS);
    const duration = (minutes || s.breachDurationMin) * MINUTE;
    const ev = this.#create(guildId, 'breach', channelId, { mech, hp: maxHp, maxHp, elite, rally: [], log: [], pool: s.breachRewardPool * (elite ? 2 : 1) }, Date.now() + duration, by);
    return this.#post(ev);
  }

  rallyStacks(state, now = Date.now()) {
    state.rally = (state.rally || []).filter((r) => r.until > now);
    return Math.min(5, state.rally.length);
  }

  #renderBreach(ev) {
    const st = ev.state;
    const f = FACTIONS[st.mech.element];
    const counter = counterOf(st.mech.element);
    const ended = ev.status !== 'active';
    const won = st.hp <= 0;
    const parts = this.participants(ev.id);
    const stacks = this.rallyStacks(st);
    const lines = [
      `## ${ICON.breach} Calamity Breach · ${st.mech.name}${st.elite ? ' ✦ Elite' : ''}`,
      `*${st.mech.flavor}*`,
      `${f.emoji} **${f.name}** Calamity Mech · ${counter ? `${FACTIONS[counter].emoji} ${FACTIONS[counter].name} Commanders deal +50%` : 'no faction holds the advantage'}`,
      '',
      `\`${bar(Math.max(0, st.hp), st.maxHp, 16, { full: '█', empty: '░' })}\` **${num(Math.max(0, st.hp))} / ${num(st.maxHp)} HP**`,
      `-# ${ended ? (won ? 'Calamity Core shattered' : 'The Mech retreated into the Wildness') : `Retreats ${discordTime(ev.ends_at, 'R')}`} · ${parts.length} Commander${parts.length === 1 ? '' : 's'} engaged${stacks ? ` · Rally ×${stacks} (+${stacks * 5}% damage)` : ''}`,
    ];
    if (st.log?.length) lines.push(`-# ${st.log.slice(-5).map((l) => `${ACTIONS[l.a].emoji} <@${l.u}> ${l.a === 's' ? 'rallied' : num(l.d)}`).join(' · ')}`);
    if (ended && parts.length) lines.push(`\n🏅 MVP <@${parts[0].user_id}> · ${num(parts[0].score)} contribution`);
    return v2([container({ accent: ended ? (won ? COLORS.success : COLORS.steel) : f.color },
      text(lines.join('\n')),
      row(
        ...Object.values(ACTIONS).map((a) => button({ id: `br:hit:${ev.id}:${a.key}`, label: a.name, emoji: a.emoji, style: a.key === 'd' ? ButtonStyle.Danger : a.key === 's' ? ButtonStyle.Success : ButtonStyle.Primary, disabled: ended })),
        button({ id: `br:intel:${ev.id}`, label: 'Intel', emoji: ICON.info, disabled: false }),
      ),
    )]);
  }

  hitBreach(ev, userId, actionKey) {
    const action = ACTIONS[actionKey];
    const st = ev.state;
    if (!action) throw new UserError('Unknown action.');
    if (ev.status !== 'active' || Date.now() > ev.ends_at || st.hp <= 0) throw new UserError('This breach is already over.', { title: 'Breach closed', tone: 'warning' });
    const p = this.participant(ev.id, userId);
    const now = Date.now();
    if (p?.data?.next && p.data.next > now) throw new UserError(`Your squad is regrouping — next action ${discordTime(p.data.next, 'R')}.`, { title: 'On cooldown', tone: 'warning' });
    const rec = this.bot.members.ensure(ev.guild_id, userId);
    const level = levelFor(rec.xp, this.bot.settings.get(ev.guild_id).leveling.curveScale);
    const mu = matchup(rec.faction, st.mech.element);
    const factionMult = mu > 0 ? 1.5 : mu < 0 ? 0.75 : 1;
    const levelMult = 1 + Math.min(level, 100) / 400;
    const stacks = this.rallyStacks(st, now);
    let damage = 0;
    let score;
    if (action.key === 's') {
      st.rally.push({ until: now + RALLY_MS, by: userId });
      score = 120;
    } else {
      damage = Math.round(action.roll() * factionMult * levelMult * (1 + stacks * 0.05));
      st.hp -= damage;
      score = damage;
    }
    st.log = [...(st.log || []), { u: userId, a: action.key, d: damage }].slice(-5);
    this.db.tx(() => {
      this.saveState(ev);
      this.upsertParticipant(ev.id, userId, { score, data: { next: now + action.cooldown, faction: rec.faction } });
    });
    return { damage, score, factionMult, stacks, next: now + action.cooldown, defeated: st.hp <= 0, action };
  }

  // ── Ending & rewards ─────────────────────────────────────────────────────
  async end(id, { reason = 'timer' } = {}) {
    const ev = this.get(id);
    if (!ev || ev.status !== 'active') return null;
    this.db.run("UPDATE events SET status = 'ended', ends_at = ? WHERE id = ?", Math.min(ev.ends_at, Date.now()), ev.id);
    this.bot.scheduler.cancel(`event:${ev.id}`);
    ev.status = 'ended';
    clearTimeout(this.renderTimers.get(ev.id));
    this.renderTimers.delete(ev.id);
    if (ev.kind === 'breach') await this.#finishBreach(ev);
    if (ev.message_id) await this.bot.api.edit(ev.channel_id, ev.message_id, this.render(ev)).catch(() => null);
    this.log.info(`event #${ev.id} (${ev.kind}) ended: ${reason}`);
    return ev;
  }

  async #finishBreach(ev) {
    const st = ev.state;
    const won = st.hp <= 0;
    const parts = this.participants(ev.id);
    if (!parts.length) return;
    const currency = this.bot.settings.currency(ev.guild_id);
    const pool = Math.round(st.pool * (won ? 1 : 0.4));
    const totalScore = parts.reduce((a, p) => a + Math.max(1, p.score), 0);
    const results = [];
    this.db.tx(() => {
      parts.forEach((p, i) => {
        let shards = Math.max(25, Math.round((pool * Math.max(1, p.score)) / totalScore));
        if (i === 0) shards = Math.round(shards * 1.2);
        this.bot.economy.credit(ev.guild_id, p.user_id, shards, 'event', { reason: `Calamity Breach ${won ? 'victory' : 'retreat'}`, ref: ev.id });
        results.push({ userId: p.user_id, shards, xp: Math.min(300, 30 + Math.round(p.score / 20)), score: p.score });
      });
    });
    for (const r of results) {
      this.bot.services.leveling.addXp(ev.guild_id, r.userId, r.xp, { source: 'event' });
      this.bot.members.bumpStat(ev.guild_id, r.userId, 'breaches');
      this.bot.activity({ type: 'event', guildId: ev.guild_id, userId: r.userId, key: `breach:${ev.id}` });
    }
    this.bot.members.bumpStat(ev.guild_id, results[0].userId, 'breach_mvp');
    const top = results.slice(0, 5).map((r, i) => `${['🥇', '🥈', '🥉', '4.', '5.'][i]} <@${r.userId}> — ${num(r.score)} · +${currency.emoji} ${num(r.shards)}`).join('\n');
    await this.bot.api.send(ev.channel_id, v2([container({ accent: won ? COLORS.success : COLORS.warning },
      text(`## ${won ? '🛡️ Breach contained' : '🌫️ The Mech retreated'}\n${won ? `**${st.mech.name}**'s Calamity Core was shattered.` : `**${st.mech.name}** escaped with ${num(st.hp)} HP left — partial salvage recovered.`} ${results.length} Commanders shared ${currency.emoji} **${num(results.reduce((a, r) => a + r.shards, 0))}**.`),
      separator(),
      text(top),
      text('-# Every participant also earned XP. MVP receives +20%.'),
    )])).catch((err) => this.log.warn(`breach results post failed: ${err.message}`));
  }

  // ── Resonance Surge ──────────────────────────────────────────────────────
  async startSurge(guildId, { by, percent, minutes, channelId }) {
    const until = Date.now() + minutes * MINUTE;
    this.bot.state.update(guildId, { surge_mult: percent / 100, surge_until: until, surge_by: by });
    const target = channelId || this.bot.settings.get(guildId).events.channelId;
    if (target && canPost(this.bot.cache, guildId, target).ok) {
      await this.bot.api.send(target, v2([container({ accent: COLORS.info },
        text(`## ${ICON.surge} Resonance Surge\nThe Sanctuary Core is overclocked — **all XP ×${(percent / 100).toFixed(2).replace(/\.?0+$/, '')}** until ${discordTime(until, 't')} (${discordTime(until, 'R')}).\n-# Chat, hop into voice and join events to make the most of it.`),
      )])).catch(() => null);
    }
    return until;
  }

  /** Minute tick: optional automatic daily breach inside the configured window. */
  async tick() {
    const now = Date.now();
    for (const guild of this.bot.cache.guilds.values()) {
      const settings = this.bot.settings.get(guild.id);
      const s = settings.events;
      if (!s.breachAuto || !s.channelId) continue;
      const today = dayKey(now, settings.general.resetHour);
      const st = this.bot.state.get(guild.id);
      if (st.breach_day === today) continue;
      const hour = new Date(now).getUTCHours();
      const start = Math.min(s.breachWindowStart, s.breachWindowEnd);
      const end = Math.max(s.breachWindowStart, s.breachWindowEnd);
      if (hour < start || hour >= end) continue;
      const endTs = new Date(now).setUTCHours(end, 0, 0, 0);
      const minutesLeft = Math.max(1, Math.round((endTs - now) / MINUTE));
      if (!chance(1 / minutesLeft)) continue;
      this.bot.state.update(guild.id, { breach_day: today });
      await this.startBreach(guild.id, s.channelId, { by: null }).catch((err) => this.log.warn(`auto breach failed: ${err.message}`));
    }
  }
}

export default function setup(bot) {
  const events = new Events(bot);
  bot.services.events = events;

  bot.scheduler.register('event.end', async ({ id }) => {
    await events.end(id, { reason: 'timer' });
  });
  bot.scheduler.every('events-tick', 60_000, () => events.tick());
  bot.onActivity((evt) => {
    if (evt.type === 'message') events.maybeAutoDrop(evt).catch(() => null);
  });

  bot.router.component('drop', async (ctx, action, id) => {
    requireGuild(ctx);
    const ev = events.get(id);
    if (!ev) throw new UserError('This crate no longer exists.', { title: 'Gone', tone: 'warning' });
    const r = events.claimDrop(ev, ctx.userId);
    const currency = bot.settings.currency(ev.guild_id);
    await ctx.reply({ ...v2([container({ accent: COLORS.gold }, text(`### ${ICON.airdrop} Supplies secured\n+${currency.long(r.amount)}`))], { ephemeral: true }) });
    if (r.full) await events.end(ev.id, { reason: 'claimed' });
    else events.scheduleRender(ev.id, 1_500);
  });

  bot.router.component('triv', async (ctx, action, id, choice) => {
    requireGuild(ctx);
    const ev = events.get(id);
    if (!ev) throw new UserError('This transmission no longer exists.', { title: 'Gone', tone: 'warning' });
    const r = events.answerTrivia(ev, ctx.userId, choice);
    const currency = bot.settings.currency(ev.guild_id);
    const body = r.correct ? (r.reward ? `### 🔓 Signal decoded!\n+${currency.long(r.reward)}` : '### 🔓 Correct!\nBut other Commanders decoded it first — no reward left this time.') : '### 📛 Signal garbled\nThat is not the answer. Better luck on the next transmission!';
    await ctx.reply(v2([container({ accent: r.correct ? COLORS.success : COLORS.danger }, text(body))], { ephemeral: true }));
    if (r.done) await events.end(ev.id, { reason: 'solved' });
    else events.scheduleRender(ev.id);
  });

  bot.router.component('br', async (ctx, action, id, key) => {
    const guildId = requireGuild(ctx);
    const ev = events.get(id);
    if (!ev) throw new UserError('This breach no longer exists.', { title: 'Gone', tone: 'warning' });
    if (action === 'intel') {
      const rec = bot.members.ensure(guildId, ctx.userId);
      const mu = matchup(rec.faction, ev.state.mech.element);
      const p = events.participant(ev.id, ctx.userId);
      const lines = [
        `### ${ICON.info} Breach intel · ${ev.state.mech.name}`,
        `Your faction: ${rec.faction ? `${FACTIONS[rec.faction].emoji} ${FACTIONS[rec.faction].name}` : 'none (pledge with `/faction`)'} → ${mu > 0 ? '**+50% damage** (counter)' : mu < 0 ? '**−25% damage** (countered)' : 'neutral'}`,
        '⚔️ **Assault** steady damage · 60s cooldown\n💥 **Devastate** wild damage swings · 120s cooldown\n🩹 **Support** rally the squad: +5% damage for everyone for 3 min (max 5 stacks) · 90s cooldown',
        p ? `Your contribution: **${num(p.score)}** over ${p.actions} action${p.actions === 1 ? '' : 's'}${p.data.next > Date.now() ? ` · ready ${discordTime(p.data.next, 'R')}` : ' · ready now'}` : 'You have not engaged yet.',
        '-# Rewards are shared by contribution; the MVP earns +20%. A retreat still pays 40% of the pool.',
      ];
      await ctx.reply(v2([container({ accent: COLORS.info }, text(lines.join('\n')))], { ephemeral: true }));
      return;
    }
    const r = events.hitBreach(ev, ctx.userId, key);
    const bonus = [];
    if (r.factionMult > 1) bonus.push('counter ×1.5');
    if (r.factionMult < 1) bonus.push('countered ×0.75');
    if (r.stacks) bonus.push(`rally +${r.stacks * 5}%`);
    const body = r.action.key === 's'
      ? `### 🩹 Squad rallied\nEveryone deals +5% damage for 3 minutes. Next action ${discordTime(r.next, 'R')}.`
      : `### ${r.action.emoji} ${r.action.name} — ${num(r.damage)} damage\n${bonus.length ? `-# ${bonus.join(' · ')}\n` : ''}Next action ${discordTime(r.next, 'R')}.`;
    await ctx.reply(v2([container({ accent: COLORS.danger }, text(body))], { ephemeral: true }));
    if (r.defeated) await events.end(ev.id, { reason: 'defeated' });
    else events.scheduleRender(ev.id);
  });
}
