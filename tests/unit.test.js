import test from 'node:test';
import assert from 'node:assert/strict';
import { xpToNext, levelProgress, totalXpForLevel, levelFor } from '../src/features/leveling/curve.js';
import { analyzeMessage, normalizeContent, weightedLength, similarity } from '../src/features/leveling/spam.js';
import { dayKey, weekKey, weekStart, monthKey, nextMonthReset, parseDuration, formatDuration, periodStart, DAY, HOUR } from '../src/util/time.js';
import { randInt, sample, seeded, seededSample, chance } from '../src/util/random.js';
import { applyOverwrites, basePermissions, has, P, canAssignRole } from '../src/core/permissions.js';
import { validateMessage, validateModal, v2, container, text, section, button, thumbnail, row, stringSelect, label, textInput, radioGroup, checkboxGroup, modal, parseEmoji } from '../src/core/components.js';
import { routeInfo, flattenErrors } from '../src/core/rest.js';
import { deepMerge, getPath, setPath } from '../src/services/settings.js';
import { matchup, rankFor, FACTION_KEYS } from '../src/content/theme.js';
import { TRIVIA, EXPEDITION_ROUTES } from '../src/content/lore.js';
import { resolveDuel } from '../src/features/duels.js';
import { rollLoot } from '../src/features/expeditions.js';
import { airdropReward, claimAirdrop } from '../src/features/daily.js';
import { applicationIdFromToken } from '../src/config.js';
import { ZlibStreamDecoder } from '../src/core/gateway.js';
import zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { createTestBot, GUILD, oldUser, ROLE } from './helpers.js';

test('xp curve is monotonic and invertible', () => {
  assert.equal(xpToNext(0), 100);
  assert.equal(xpToNext(10), 1100);
  for (let l = 0; l < 200; l += 1) assert.ok(xpToNext(l + 1) > xpToNext(l));
  for (const lvl of [0, 1, 5, 17, 50, 120]) {
    const total = totalXpForLevel(lvl);
    assert.equal(levelFor(total), lvl);
    assert.equal(levelFor(total - 1), Math.max(0, lvl - 1));
  }
  const p = levelProgress(totalXpForLevel(7) + 50);
  assert.deepEqual([p.level, p.into, p.needed], [7, 50, xpToNext(7)]);
  assert.ok(levelFor(10_000, 200) < levelFor(10_000, 100), 'larger scale means slower levels');
});

test('spam analysis rewards real messages and rejects junk', () => {
  assert.equal(analyzeMessage('hey everyone, who is pulling on the new banner?').ok, true);
  assert.equal(analyzeMessage('lol').reason, 'too-short');
  assert.equal(analyzeMessage('aaaaaaaaaaaaaaaa').reason, 'repetitive');
  assert.equal(analyzeMessage('hahahahahahahaha nice').reason, 'repetitive');
  assert.equal(analyzeMessage('spam spam spam spam spam spam spam').reason, 'repetitive');
  assert.equal(analyzeMessage('<:emoji:123456789012345678> <@123456789012345678> https://x.y/z').reason, 'empty');
  const recent = [normalizeContent('Does anyone know when the next banner starts?')];
  assert.equal(analyzeMessage('does anyone know when the next banner starts', { recent }).reason, 'duplicate');
  assert.equal(analyzeMessage('totally different topic about mechmon pets', { recent }).ok, true);
  // CJK text counts double so short Japanese/Korean sentences still qualify.
  assert.equal(weightedLength(normalizeContent('ガチャ引いた')), 12);
  assert.equal(analyzeMessage('ガチャ引いた').ok, true);
  // Media-only posts are allowed but earn less.
  const media = analyzeMessage('', { attachments: 1 });
  assert.equal(media.ok, true);
  assert.equal(media.quality, 0.6);
  assert.equal(analyzeMessage('anything', { hasContent: false }).ok, true);
  assert.equal(similarity('good morning', 'good night'), 0);
});

test('time keys roll over at the reset hour and weeks start on Monday', () => {
  const mondayNoon = Date.UTC(2026, 10, 9, 12); // Mon 9 Nov 2026
  const sundayNight = Date.UTC(2026, 10, 8, 23);
  assert.equal(weekKey(mondayNoon), weekKey(sundayNight) + 1);
  assert.equal(new Date(weekStart(weekKey(mondayNoon))).getUTCDay(), 1);
  assert.equal(dayKey(Date.UTC(2026, 0, 2, 3), 4), dayKey(Date.UTC(2026, 0, 1, 12), 4));
  assert.equal(monthKey(Date.UTC(2026, 10, 30, 23)), '2026-11');
  assert.equal(nextMonthReset(Date.UTC(2026, 10, 15)), Date.UTC(2026, 11, 1));
  assert.equal(periodStart('daily', Date.UTC(2026, 10, 15, 13)), Date.UTC(2026, 10, 15));
  assert.equal(parseDuration('2h30m'), 2.5 * HOUR);
  assert.equal(parseDuration('1d'), DAY);
  assert.equal(parseDuration('45'), 45 * 60_000);
  assert.equal(parseDuration('soon'), null);
  assert.equal(formatDuration(90 * 60_000), '1h 30m');
});

test('randomness helpers', () => {
  for (let i = 0; i < 200; i += 1) {
    const n = randInt(3, 7);
    assert.ok(n >= 3 && n <= 7);
  }
  const s = sample([1, 2, 3, 4, 5], 3);
  assert.equal(new Set(s).size, 3);
  assert.deepEqual(seededSample([1, 2, 3, 4, 5, 6], 3, seeded('a')), seededSample([1, 2, 3, 4, 5, 6], 3, seeded('a')));
  assert.equal(chance(0), false);
  assert.equal(chance(1), true);
});

test('permission computation honours overwrites and admin', () => {
  const guild = { id: 'g', ownerId: 'owner', roles: new Map([['g', { permissions: String(P.VIEW_CHANNEL | P.SEND_MESSAGES) }], ['admin', { permissions: String(P.ADMINISTRATOR) }]]) };
  const base = basePermissions(guild, 'u', []);
  assert.ok(has(base, P.SEND_MESSAGES));
  const channel = { overwrites: [{ id: 'g', type: 0, allow: '0', deny: String(P.SEND_MESSAGES) }, { id: 'u', type: 1, allow: String(P.SEND_MESSAGES), deny: '0' }] };
  assert.ok(!has(applyOverwrites(base, guild, channel, 'x', []), P.SEND_MESSAGES));
  assert.ok(has(applyOverwrites(base, guild, channel, 'u', []), P.SEND_MESSAGES));
  assert.ok(has(basePermissions(guild, 'u', ['admin']), P.MANAGE_ROLES));
  const hidden = { overwrites: [{ id: 'g', type: 0, allow: '0', deny: String(P.VIEW_CHANNEL) }] };
  assert.equal(applyOverwrites(base, guild, hidden, 'x', []), 0n);
});

test('role assignment checks hierarchy and Manage Roles', () => {
  const bot = createTestBot();
  assert.equal(canAssignRole(bot.cache, GUILD, ROLE.reward).ok, true);
  assert.equal(canAssignRole(bot.cache, GUILD, ROLE.bot).ok, false, 'managed role');
  bot.cache.guild(GUILD).roles.get(ROLE.reward).position = 20;
  assert.match(canAssignRole(bot.cache, GUILD, ROLE.reward).reason, /above/);
});

test('component validator enforces documented limits', () => {
  const ok = v2([container({ accent: 0xff0000 }, text('hi'), section(['a', 'b'], thumbnail('https://x/y.png')), row(button({ id: 'a', label: 'A' }), button({ id: 'b', label: 'B' })))]);
  assert.deepEqual(validateMessage(ok), []);
  const dup = v2([row(button({ id: 'a', label: 'A' }), button({ id: 'a', label: 'B' }))]);
  assert.match(validateMessage(dup).join(), /duplicate custom_id/);
  const mixed = v2([row(button({ id: 'a', label: 'A' }), stringSelect({ id: 's', options: [{ label: 'x', value: 'x' }] }))]);
  assert.match(validateMessage(mixed).join(), /one select OR/);
  const tooMany = v2(Array.from({ length: 41 }, (_, i) => text(`t${i}`)));
  assert.match(validateMessage(tooMany).join(), /too many components/);
  const longText = v2([text('x'.repeat(4001))]);
  assert.match(validateMessage(longText).join(), /4000/);
  const withContent = { ...ok, content: 'nope' };
  assert.match(validateMessage(withContent).join(), /content is not allowed/);
  const goodModal = modal({ id: 'm', title: 'Title', components: [label('Name', textInput({ id: 'n' })), label('Pick', radioGroup({ id: 'r', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] })), label('Flags', checkboxGroup({ id: 'c', required: false, min: 0, options: [{ value: 'x', label: 'X' }] }))] });
  assert.deepEqual(validateModal(goodModal), []);
  // Raw object (the builder would clip the title for us).
  const badModal = { custom_id: 'm', title: 'x'.repeat(46), components: Array.from({ length: 6 }, (_, i) => label(`L${i}`, textInput({ id: `i${i}` }))) };
  const errs = validateModal(badModal);
  assert.match(errs.join(), /title/);
  assert.match(errs.join(), /1-5 top-level/);
  assert.equal(modal({ id: 'm', title: 'x'.repeat(60), components: [label('A', textInput({ id: 'a' }))] }).title.length, 45);
  assert.deepEqual(parseEmoji('<a:wave:123456789012345678>'), { id: '123456789012345678', name: 'wave', animated: true });
});

test('rest route keys group major parameters', () => {
  const a = routeInfo('POST', '/channels/123456789012345678/messages');
  const b = routeInfo('POST', '/channels/223456789012345678/messages');
  assert.equal(a.routeId, b.routeId);
  assert.notEqual(a.major, b.major);
  assert.equal(routeInfo('POST', '/interactions/123456789012345678/tok/callback').exempt, true);
  assert.deepEqual(flattenErrors({ components: { 0: { label: { _errors: [{ code: 'X', message: 'too long' }] } } } }), ['components[0].label: too long (X)']);
});

test('settings deep merge keeps defaults and overrides', () => {
  const merged = deepMerge({ a: { b: 1, c: [1] }, d: 2 }, { a: { c: [2, 3] } });
  assert.deepEqual(merged, { a: { b: 1, c: [2, 3] }, d: 2 });
  const o = {};
  setPath(o, 'x.y.z', 5);
  assert.equal(getPath(o, 'x.y.z'), 5);
});

test('faction matchups follow the counter loop', () => {
  assert.equal(matchup('inferno', 'rancor'), 1);
  assert.equal(matchup('rancor', 'flare'), 1);
  assert.equal(matchup('flare', 'void'), 1);
  assert.equal(matchup('void', 'inferno'), 1);
  assert.equal(matchup('rancor', 'inferno'), -1);
  assert.equal(matchup('inferno', 'flare'), 0);
  for (const k of FACTION_KEYS) assert.equal(matchup('nebula', k), 0);
  assert.equal(resolveDuel('void', 'inferno'), 'challenger');
  assert.equal(resolveDuel('inferno', 'void'), 'opponent');
  assert.equal(resolveDuel('nebula', 'void'), 'draw');
  assert.equal(rankFor(0).name, 'Drifter');
  assert.equal(rankFor(42).name, 'Sanctuary Commander');
});

test('trivia bank is well formed', () => {
  for (const t of TRIVIA) {
    assert.equal(t.answers.length, 4, t.q);
    assert.ok(t.correct >= 0 && t.correct < 4);
    assert.equal(new Set(t.answers).size, 4, t.q);
    for (const a of t.answers) assert.ok(`A · ${a}`.length <= 80);
  }
});

test('expedition loot respects hazard advantage', () => {
  const route = EXPEDITION_ROUTES.sweep;
  for (let i = 0; i < 50; i += 1) {
    const loot = rollLoot(route, 'flare', 'void');
    assert.equal(loot.advantage, true);
    assert.ok(loot.shards >= Math.round(route.shards[0] * 1.25));
  }
});

test('economy ledger is atomic and refuses overdrafts', () => {
  const bot = createTestBot();
  const u = oldUser(10);
  assert.equal(bot.economy.credit(GUILD, u, 500, 'test'), 500);
  assert.equal(bot.economy.debit(GUILD, u, 200, 'test'), 300);
  assert.throws(() => bot.economy.debit(GUILD, u, 1000, 'test'), /need/);
  assert.equal(bot.economy.balance(GUILD, u), 300);
  assert.deepEqual(bot.economy.adjust(GUILD, u, -1000, { reason: 'x' }), { applied: -300, balance: 0 });
  assert.equal(bot.economy.history(GUILD, u).length, 3);
});

test('supply airdrop streaks, milestones and streak shields', () => {
  const bot = createTestBot();
  const u = oldUser(11);
  const day = (n) => Date.UTC(2026, 0, 1 + n, 12);
  assert.equal(claimAirdrop(bot, GUILD, u, day(0)).streak, 1);
  assert.equal(claimAirdrop(bot, GUILD, u, day(0)).claimed, false);
  for (let d = 1; d < 7; d += 1) claimAirdrop(bot, GUILD, u, day(d));
  assert.equal(bot.members.get(GUILD, u).streak, 7);
  assert.equal(airdropReward(bot.settings.get(GUILD), 7).milestone, '7-day supply cache');
  // Miss one day without a shield: streak resets.
  assert.equal(claimAirdrop(bot, GUILD, u, day(8)).streak, 1);
  // With a shield, one missed day is forgiven.
  bot.db.run("INSERT INTO inventory (guild_id, user_id, item_key, quantity, acquired_at) VALUES (?, ?, 'consumable:streak_shield', 1, 0)", GUILD, u);
  const r = claimAirdrop(bot, GUILD, u, day(10));
  assert.equal(r.shieldUsed, true);
  assert.equal(r.streak, 2);
});

test('directives are stable per member and progress with activity', () => {
  const bot = createTestBot();
  const u = oldUser(12);
  const q = bot.services.quests;
  const settings = bot.settings.get(GUILD);
  const keys = q.keys(settings);
  const first = q.ensure(GUILD, u, 'daily', keys.daily, settings).map((r) => r.quest_key);
  bot.db.run('DELETE FROM quests');
  const second = q.ensure(GUILD, u, 'daily', keys.daily, settings).map((r) => r.quest_key);
  assert.deepEqual(first, second, 'seeded assignment is deterministic');
  // Force known directives (other slots get an unrelated, long directive) and complete one.
  bot.db.run("UPDATE quests SET quest_key = 'd_messages', target = 999, progress = 0 WHERE user_id = ?", u);
  bot.db.run("UPDATE quests SET quest_key = 'd_daily', target = 1, progress = 0 WHERE user_id = ? AND period = 'daily' AND slot = 0", u);
  bot.activity({ type: 'daily', guildId: GUILD, userId: u });
  const row = bot.db.get("SELECT * FROM quests WHERE user_id = ? AND period = 'daily' AND slot = 0", u);
  assert.ok(row.completed_at);
  const res = q.claim(GUILD, u);
  assert.equal(res.count, 1);
  assert.ok(bot.economy.balance(GUILD, u) >= row.reward_shards);
  // Distinct replies only count unique targets.
  bot.db.run("UPDATE quests SET quest_key = 'd_replies', target = 2, progress = 0, completed_at = NULL, claimed_at = NULL, meta = NULL WHERE user_id = ? AND period = 'daily' AND slot = 1", u);
  bot.activity({ type: 'reply', guildId: GUILD, userId: u, key: 'a' });
  bot.activity({ type: 'reply', guildId: GUILD, userId: u, key: 'a' });
  assert.equal(bot.db.get("SELECT progress FROM quests WHERE user_id = ? AND period = 'daily' AND slot = 1", u).progress, 1);
  bot.activity({ type: 'reply', guildId: GUILD, userId: u, key: 'b' });
  assert.ok(bot.db.get("SELECT completed_at FROM quests WHERE user_id = ? AND period = 'daily' AND slot = 1", u).completed_at);
});

test('supply depot enforces level, limits, stock and funds', () => {
  const bot = createTestBot();
  const u = oldUser(13);
  const cat = bot.services.catalog;
  const items = cat.list(GUILD);
  const shield = items.find((i) => i.name === 'Streak Shield');
  const title = items.find((i) => i.name === 'Pax Sentinel');
  assert.match(cat.blocker(GUILD, u, shield), /Not enough/);
  bot.economy.credit(GUILD, u, 100_000, 'test');
  assert.match(cat.blocker(GUILD, u, title), /level 10/);
  cat.purchase(GUILD, u, shield.id, 2);
  assert.match(cat.blocker(GUILD, u, shield), /limit/i, 'weekly limit of 2');
  const wanderer = items.find((i) => i.name === 'Wildness Wanderer');
  cat.purchase(GUILD, u, wanderer.id, 1);
  assert.match(cat.blocker(GUILD, u, wanderer), /already own/);
  const limited = cat.create(GUILD, { kind: 'consumable', name: 'Limited', price: 10, stock: 1, stock_period: 'none', data: { effect: 'xp_boost' }, enabled: true });
  cat.purchase(GUILD, u, limited.id, 1);
  assert.match(cat.blocker(GUILD, oldUser(14), limited), /Sold out|Not enough/);
  assert.equal(bot.db.get("SELECT quantity FROM inventory WHERE user_id = ? AND item_key = 'consumable:streak_shield'", u).quantity, 2);
});

test('application id is derived from the token', () => {
  const token = `${Buffer.from('1234567890123456789').toString('base64')}.abc.def`;
  assert.equal(applicationIdFromToken(token), '1234567890123456789');
  assert.equal(applicationIdFromToken('garbage'), null);
});

test('zlib-stream decoder handles split frames with a shared context', async () => {
  const deflate = zlib.createDeflate();
  const chunks = [];
  deflate.on('data', (c) => chunks.push(c));
  const flush = () => new Promise((r) => deflate.flush(zlib.constants.Z_SYNC_FLUSH, r));
  const decoder = new ZlibStreamDecoder();
  deflate.write(JSON.stringify({ op: 10, d: { heartbeat_interval: 41250 } }));
  await flush();
  let frame = Buffer.concat(chunks.splice(0));
  assert.equal(JSON.parse(await decoder.push(frame)).op, 10);
  deflate.write(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { big: randomBytes(4000).toString('hex') } }));
  await flush();
  frame = Buffer.concat(chunks.splice(0));
  const mid = Math.floor(frame.length / 2);
  assert.equal(await decoder.push(frame.subarray(0, mid)), null, 'partial frame yields nothing');
  const out = JSON.parse(await decoder.push(frame.subarray(mid)));
  assert.equal(out.t, 'READY');
  decoder.destroy();
});
