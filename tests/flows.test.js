// End-to-end interaction flows through the real router with a mocked REST layer.
// Every response payload is validated against Discord's documented component/modal limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestBot, command, component, submitModal, payloadProblems, lastResponse, textOf, messageCreate, oldUser, GUILD, CH, ROLE, MANAGER_PERMS, BOT_ID } from './helpers.js';
import { totalXpForLevel } from '../src/features/leveling/curve.js';

function noErrors(bot, since = 0) {
  const problems = payloadProblems(bot, since);
  assert.deepEqual(problems, [], problems.join('\n'));
  const errors = bot.calls.slice(since).filter((c) => c.body?.data?.components && textOf(c.body).includes('System fault'));
  assert.equal(errors.length, 0, `handler crashed: ${errors.map((e) => textOf(e.body)).join(' | ')}`);
}

test('member commands render valid Components V2 payloads', async () => {
  const bot = createTestBot();
  const u = oldUser(1);
  bot.economy.credit(GUILD, u, 50_000, 'test');
  for (const name of ['profile', 'leaderboard', 'daily', 'quests', 'shop', 'inventory', 'faction', 'expedition', 'help', 'archive', 'codes']) {
    const before = bot.calls.length;
    await command(bot, name, { userId: u });
    noErrors(bot, before);
    const res = lastResponse(bot);
    assert.ok(res, `${name} responded`);
    assert.equal(res.type, 4, `${name} replied with a message`);
  }
});

test('profile edit + game link modals round-trip', async () => {
  const bot = createTestBot();
  const u = oldUser(2);
  await command(bot, 'profile', { userId: u });
  await component(bot, `prof:edit:${u}`, { userId: u });
  assert.equal(lastResponse(bot).type, 9);
  await submitModal(bot, 'prof:dossier', { bio: 'Tsubaki main, Void enjoyer', main: 'tsubaki', ping: false }, { userId: u });
  let rec = bot.members.get(GUILD, u);
  assert.equal(rec.main_stellaris, 'Tsubaki');
  assert.equal(rec.levelup_ping, 0);
  await component(bot, `prof:link:${u}`, { userId: u });
  const before = bot.calls.length;
  await submitModal(bot, 'prof:linksave', { region: 'sea', server: 'S12', uid: '12345678', public: true }, { userId: u });
  noErrors(bot, before);
  rec = bot.members.get(GUILD, u);
  assert.deepEqual([rec.game_region, rec.game_server, rec.game_uid, rec.uid_public], ['sea', 'S12', '12345678', 1]);
  // Another member cannot edit the card.
  await component(bot, `prof:edit:${u}`, { userId: oldUser(3) });
  assert.match(textOf(lastResponse(bot)), /Not your card/);
});

test('chat XP: cooldown, spam filter, level-up announcement and reward role', async () => {
  const bot = createTestBot({ 'leveling.rewards': [{ level: 1, roleId: ROLE.reward }], 'leveling.cooldownSec': 60 });
  const u = oldUser(4);
  await messageCreate(bot, { userId: u });
  const after1 = bot.members.get(GUILD, u);
  assert.ok(after1.xp >= 15 && after1.xp <= 30, `first message xp ${after1.xp}`);
  await messageCreate(bot, { userId: u, content: 'another thoughtful message right away' });
  assert.equal(bot.members.get(GUILD, u).xp, after1.xp, 'cooldown blocks XP');
  bot.members.update(GUILD, u, { last_xp_at: 0 });
  await messageCreate(bot, { userId: u, content: 'aaaaaaaaaaaaaaaaaaaa' });
  assert.equal(bot.members.get(GUILD, u).xp, after1.xp, 'spam earns nothing');
  // Push the member just below level 1 and trigger a level-up.
  bot.members.update(GUILD, u, { xp: totalXpForLevel(1) - 1, last_xp_at: 0 });
  const before = bot.calls.length;
  await messageCreate(bot, { userId: u, content: 'what does everyone think about the carnival event?' });
  await new Promise((r) => setTimeout(r, 30));
  const rec = bot.members.get(GUILD, u);
  assert.equal(rec.level, 1);
  const roleCall = bot.calls.slice(before).find((c) => c.method === 'PUT' && c.path.includes(`/roles/${ROLE.reward}`));
  assert.ok(roleCall, 'reward role granted');
  assert.ok(bot.economy.balance(GUILD, u) > 0, 'level-up shards credited');
  noErrors(bot, before);
});

test('voice ticker awards XP only with company and unmuted', () => {
  const bot = createTestBot();
  const a = oldUser(5);
  const b = oldUser(6);
  const guild = bot.cache.guild(GUILD);
  guild.voice.set(a, { channelId: CH.voice, selfMute: false, selfDeaf: false, mute: false, deaf: false, suppress: false, bot: false });
  bot.services.leveling.tickVoice();
  assert.equal(bot.members.get(GUILD, a), null, 'alone earns nothing');
  guild.voice.set(b, { channelId: CH.voice, selfMute: true, selfDeaf: false, mute: false, deaf: false, suppress: false, bot: false });
  bot.services.leveling.tickVoice();
  assert.equal(bot.members.get(GUILD, a).voice_minutes, 1);
  assert.equal(bot.members.get(GUILD, b), null, 'muted member earns nothing');
});

test('daily claim, quests claim-all and inventory flows', async () => {
  const bot = createTestBot();
  const u = oldUser(7);
  const before = bot.calls.length;
  await command(bot, 'daily', { userId: u });
  assert.match(textOf(lastResponse(bot)), /Supply Airdrop secured/);
  await command(bot, 'daily', { userId: u });
  assert.match(textOf(lastResponse(bot)), /already secured/);
  await component(bot, 'quests:open', { userId: u });
  await component(bot, 'quests:claim:all', { userId: u });
  await component(bot, 'inv:open', { userId: u });
  await component(bot, 'inv:reqs', { userId: u });
  noErrors(bot, before);
});

test('supply depot: browse, buy title, equip, buy booster with quantity, activate', async () => {
  const bot = createTestBot();
  const u = oldUser(8);
  bot.economy.credit(GUILD, u, 20_000, 'test');
  const before = bot.calls.length;
  const items = bot.services.catalog.list(GUILD);
  const title = items.find((i) => i.name === 'Wildness Wanderer');
  const booster = items.find((i) => i.name === 'Resonance Booster');
  await component(bot, 'shop:cat', { userId: u, values: ['title'], componentType: 3 });
  await component(bot, 'shop:pg:all:1:n', { userId: u });
  await component(bot, `shop:item:${title.id}:all:0`, { userId: u });
  await component(bot, `shop:buy:${title.id}:all:0`, { userId: u });
  await component(bot, `shop:confirm:${title.id}:1:all:0`, { userId: u });
  assert.match(textOf(lastResponse(bot)), /Purchase complete/);
  await component(bot, 'inv:title', { userId: u, values: [`title:${title.id}`], componentType: 3 });
  assert.equal(bot.members.get(GUILD, u).title, 'Wildness Wanderer');
  await component(bot, `shop:buy:${booster.id}:all:0`, { userId: u });
  assert.equal(lastResponse(bot).type, 9, 'quantity modal');
  await submitModal(bot, `shop:qty:${booster.id}:all:0`, { qty: '2' }, { userId: u });
  await component(bot, `shop:confirm:${booster.id}:2:all:0`, { userId: u });
  await component(bot, 'inv:boost', { userId: u, values: [`boost:${booster.id}`], componentType: 3 });
  const rec = bot.members.get(GUILD, u);
  assert.equal(rec.boost_mult, 125);
  assert.ok(rec.boost_until > Date.now());
  noErrors(bot, before);
});

test('in-game reward requisition: file, staff reject with refund', async () => {
  const bot = createTestBot({ 'shop.requisitionChannelId': CH.queue });
  const u = oldUser(9);
  const staffer = oldUser(99);
  bot.members.ensure(GUILD, u);
  bot.members.update(GUILD, u, { xp: totalXpForLevel(15) });
  bot.economy.credit(GUILD, u, 10_000, 'test');
  const item = bot.services.catalog.list(GUILD, { includeDisabled: true }).find((i) => i.kind === 'fulfillment' && i.name.startsWith('Diamonds'));
  bot.services.catalog.update(GUILD, item.id, { enabled: true });
  const before = bot.calls.length;
  await component(bot, `shop:buy:${item.id}:all:0`, { userId: u });
  assert.equal(lastResponse(bot).type, 9);
  await submitModal(bot, `shop:req:${item.id}`, { region: 'global', server: 'S3', uid: '88776655', note: 'thanks!' }, { userId: u });
  assert.match(textOf(lastResponse(bot)), /Requisition \*\*#1\*\*/);
  const ticket = bot.calls.slice(before).find((c) => c.method === 'POST' && c.path === `/channels/${CH.queue}/messages`);
  assert.ok(ticket?.body.embeds?.[0].title.includes('Requisition #1'));
  const balanceAfterBuy = bot.economy.balance(GUILD, u);
  await component(bot, 'req:no:1', { userId: staffer, permissions: MANAGER_PERMS, ephemeral: false });
  assert.equal(lastResponse(bot).type, 9);
  await submitModal(bot, 'req:reject:1', { reason: 'UID not found' }, { userId: staffer, permissions: MANAGER_PERMS });
  assert.equal(bot.economy.balance(GUILD, u), balanceAfterBuy + item.price, 'refunded');
  assert.equal(bot.services.requisitions.get(GUILD, 1).status, 'rejected');
  // Non-staff cannot fulfil.
  await component(bot, 'req:ok:1', { userId: u });
  assert.match(textOf(lastResponse(bot)), /Staff only/);
  noErrors(bot, before);
});

test('factions: pledge, earn points, weekly finalize rewards winners', async () => {
  const bot = createTestBot({ 'events.channelId': CH.events, 'factions.minContribution': 10 });
  const u = oldUser(10);
  const before = bot.calls.length;
  await component(bot, 'fac:pledge:void', { userId: u });
  assert.equal(bot.members.get(GUILD, u).faction, 'void');
  bot.services.leveling.addXp(GUILD, u, 500, { source: 'test' });
  const wk = bot.services.factions.week(GUILD);
  assert.equal(bot.services.factions.standings(GUILD, wk)[0].faction, 'void');
  const balance = bot.economy.balance(GUILD, u);
  const res = await bot.services.factions.finalizeWeek(GUILD, wk);
  assert.deepEqual(res.winners, ['void']);
  assert.equal(bot.economy.balance(GUILD, u), balance + 200);
  assert.equal(await bot.services.factions.finalizeWeek(GUILD, wk), null, 'idempotent');
  await component(bot, 'fac:switch:inferno', { userId: u });
  assert.match(textOf(lastResponse(bot)), /on cooldown|Switch to/);
  noErrors(bot, before);
});

test('events: supply drop, trivia and calamity breach full lifecycle', async () => {
  const bot = createTestBot({ 'events.channelId': CH.events });
  const staffer = oldUser(98);
  const players = [oldUser(20), oldUser(21), oldUser(22)];
  // Supply crates require level 1 (anti-alt), so give the players a little history.
  for (const p of players) bot.services.leveling.addXp(GUILD, p, 150, { silent: true });
  const before = bot.calls.length;
  // Supply drop
  await command(bot, 'staff', { sub: 'event', options: [{ name: 'type', type: 3, value: 'drop' }], userId: staffer, permissions: MANAGER_PERMS });
  const drop = bot.services.events.active(GUILD, 'drop')[0];
  assert.ok(drop);
  await component(bot, `drop:claim:${drop.id}`, { userId: players[0], ephemeral: false });
  assert.match(textOf(lastResponse(bot)), /Supplies secured/);
  await component(bot, `drop:claim:${drop.id}`, { userId: players[0], ephemeral: false });
  assert.match(textOf(lastResponse(bot)), /Already secured/);
  // Trivia
  await command(bot, 'staff', { sub: 'event', options: [{ name: 'type', type: 3, value: 'trivia' }], userId: staffer, permissions: MANAGER_PERMS });
  const triv = bot.services.events.active(GUILD, 'trivia')[0];
  await component(bot, `triv:ans:${triv.id}:${(triv.state.correct + 1) % 4}`, { userId: players[1], ephemeral: false });
  assert.match(textOf(lastResponse(bot)), /garbled/);
  await component(bot, `triv:ans:${triv.id}:${triv.state.correct}`, { userId: players[2], ephemeral: false });
  assert.match(textOf(lastResponse(bot)), /decoded/);
  // Breach
  await command(bot, 'staff', { sub: 'event', options: [{ name: 'type', type: 3, value: 'breach' }], userId: staffer, permissions: MANAGER_PERMS });
  const br = bot.services.events.active(GUILD, 'breach')[0];
  await component(bot, `br:hit:${br.id}:a`, { userId: players[0], ephemeral: false });
  await component(bot, `br:hit:${br.id}:s`, { userId: players[1], ephemeral: false });
  await component(bot, `br:hit:${br.id}:a`, { userId: players[0], ephemeral: false });
  assert.match(textOf(lastResponse(bot)), /On cooldown/);
  await component(bot, `br:intel:${br.id}`, { userId: players[2], ephemeral: false });
  const ended = await bot.services.events.end(br.id, { reason: 'test' });
  assert.equal(ended.status, 'ended');
  assert.ok(bot.economy.balance(GUILD, players[0]) > 0);
  await bot.services.events.end(drop.id);
  await bot.services.events.end(triv.id);
  noErrors(bot, before);
  for (const t of bot.services.events.renderTimers.values()) clearTimeout(t);
});

test('giveaway lifecycle with entry fee, winners and UID claim', async () => {
  const bot = createTestBot({ 'shop.requisitionChannelId': CH.queue });
  const host = oldUser(97);
  const entrants = [oldUser(30), oldUser(31)];
  for (const e of entrants) bot.economy.credit(GUILD, e, 1_000, 'test');
  const before = bot.calls.length;
  await command(bot, 'giveaway', { sub: 'start', options: [{ name: 'entry_cost', type: 4, value: 100 }, { name: 'in_game_prize', type: 5, value: true }], userId: host, permissions: MANAGER_PERMS });
  assert.equal(lastResponse(bot).type, 9);
  const modalId = lastResponse(bot).data.custom_id;
  await submitModal(bot, modalId, { prize: 'Advanced Echo Permit ×5', winners: '1', duration: '1h', level: '0', desc: 'Good luck!' }, { userId: host, permissions: MANAGER_PERMS, fromMessage: false });
  const g = bot.services.giveaways.get(1);
  assert.equal(g.entry_cost, 100);
  for (const e of entrants) await component(bot, `gw:enter:${g.id}`, { userId: e, ephemeral: false });
  assert.equal(bot.economy.balance(GUILD, entrants[0]), 900);
  await component(bot, `gw:leave:${g.id}`, { userId: entrants[1], ephemeral: false });
  assert.equal(bot.economy.balance(GUILD, entrants[1]), 1_000, 'fee refunded on leave');
  await component(bot, `gw:odds:${g.id}`, { userId: entrants[0], ephemeral: false });
  const ended = await bot.services.giveaways.end(g.id);
  assert.deepEqual(ended.winner_ids, [entrants[0]]);
  // Winner claims from DM (no guild on the interaction).
  const raw = { ...(await import('./helpers.js')).makeInteraction({ type: 3, data: { custom_id: `gw:claim:${g.id}:${GUILD}`, component_type: 2 }, userId: entrants[0] }) };
  delete raw.guild_id;
  raw.user = raw.member.user;
  delete raw.member;
  await bot.router.dispatch(raw);
  assert.equal(lastResponse(bot).type, 9);
  await submitModal(bot, `gw:claimsave:${g.id}:${GUILD}`, { region: 'global', server: 'S1', uid: '11223344' }, { userId: entrants[0] });
  assert.equal(bot.db.get("SELECT COUNT(*) AS n FROM requisitions WHERE source = 'giveaway'").n, 1);
  await command(bot, 'giveaway', { sub: 'list', userId: host, permissions: MANAGER_PERMS });
  noErrors(bot, before);
  for (const t of bot.services.giveaways.renderTimers.values()) clearTimeout(t);
});

test('expeditions and duels', async () => {
  const bot = createTestBot();
  const a = oldUser(40);
  const b = oldUser(41);
  bot.economy.credit(GUILD, a, 1_000, 'test');
  bot.economy.credit(GUILD, b, 1_000, 'test');
  const before = bot.calls.length;
  await component(bot, 'exp:go', { userId: a, values: ['sweep'], componentType: 3 });
  bot.db.run('UPDATE expeditions SET ends_at = 0 WHERE user_id = ?', a);
  await component(bot, 'exp:claim', { userId: a });
  assert.match(textOf(lastResponse(bot)), /complete/);
  await component(bot, 'exp:relics', { userId: a });
  await component(bot, 'exp:salvage', { userId: a });
  // Duel: void (a) beats inferno (b).
  await command(bot, 'duel', { options: [{ name: 'opponent', type: 6, value: b }, { name: 'stake', type: 4, value: 100 }], resolved: { users: { [b]: { id: b, username: 'b' } } }, userId: a });
  const d = bot.services.duels.get(1);
  assert.equal(d.status, 'pending');
  await component(bot, `duel:accept:${d.id}`, { userId: a, ephemeral: false });
  assert.match(textOf(lastResponse(bot)), /Only the challenged/);
  await component(bot, `duel:accept:${d.id}`, { userId: b, ephemeral: false });
  assert.equal(bot.economy.balance(GUILD, b), 900, 'stake escrowed');
  await component(bot, `duel:lock:${d.id}`, { userId: a, ephemeral: false });
  await component(bot, `duel:pick:${d.id}:void`, { userId: a });
  await component(bot, `duel:pick:${d.id}:inferno`, { userId: b });
  const done = bot.services.duels.get(d.id);
  assert.equal(done.winner_id, a);
  const aBalance = bot.economy.balance(GUILD, a);
  assert.ok(aBalance > 1_000, `winner balance ${aBalance}`);
  noErrors(bot, before);
});

test('staff tools: adjust, inspect actions, codes, trivia, season', async () => {
  const bot = createTestBot({ 'events.channelId': CH.events });
  const staffer = oldUser(96);
  const u = oldUser(50);
  const perms = { userId: staffer, permissions: MANAGER_PERMS };
  const before = bot.calls.length;
  await command(bot, 'staff', { sub: 'adjust', options: [{ name: 'member', type: 6, value: u }, { name: 'currency', type: 3, value: 'shards' }, { name: 'amount', type: 4, value: 750 }, { name: 'reason', type: 3, value: 'Event prize' }], resolved: { users: { [u]: { id: u, username: 'u' } } }, ...perms });
  assert.equal(bot.economy.balance(GUILD, u), 750);
  await command(bot, 'staff', { sub: 'adjust', options: [{ name: 'member', type: 6, value: u }, { name: 'currency', type: 3, value: 'xp' }, { name: 'amount', type: 4, value: 5000 }, { name: 'reason', type: 3, value: 'Migration' }], resolved: { users: { [u]: { id: u, username: 'u' } } }, ...perms });
  assert.ok(bot.members.get(GUILD, u).level > 1);
  await component(bot, `staff:adj:${u}:shards`, perms);
  await submitModal(bot, `staff:adjsave:${u}:shards`, { amount: '-50', reason: 'typo' }, perms);
  assert.equal(bot.economy.balance(GUILD, u), 700 + bot.db.get("SELECT COALESCE(SUM(delta),0) AS s FROM ledger WHERE user_id = ? AND kind = 'levelup'", u).s);
  await component(bot, `staff:reset:${u}`, perms);
  await component(bot, `staff:resetok:${u}`, perms);
  assert.equal(bot.members.get(GUILD, u).xp, 0);
  await command(bot, 'staff', { sub: 'codes', ...perms });
  await submitModal(bot, 'staff:codesave', { code: 'AGM134', rewards: '300 Diamonds', expires: '7d', region: 'all' }, perms);
  await command(bot, 'codes', { userId: u });
  assert.match(textOf(lastResponse(bot)), /AGM134/);
  await command(bot, 'staff', { sub: 'trivia', ...perms });
  await submitModal(bot, 'staff:trivsave', { q: 'Which city has three walls?', a0: 'Pax', a1: 'Noah', a2: 'Iris', a3: 'Trelinton' }, perms);
  assert.equal(bot.db.get('SELECT COUNT(*) AS n FROM trivia').n, 1);
  await command(bot, 'staff', { sub: 'requisitions', ...perms });
  await command(bot, 'staff', { sub: 'season', ...perms });
  await command(bot, 'staff', { sub: 'event', options: [{ name: 'type', type: 3, value: 'surge' }, { name: 'percent', type: 4, value: 200 }, { name: 'minutes', type: 4, value: 30 }], ...perms });
  assert.equal(bot.state.surge(GUILD), 2);
  // Regular members are refused.
  await command(bot, 'staff', { sub: 'season', userId: u });
  assert.match(textOf(lastResponse(bot)), /Staff only/);
  noErrors(bot, before);
});

test('setup dashboard: every section and every settings modal', async () => {
  const bot = createTestBot();
  const admin = { userId: oldUser(95), permissions: MANAGER_PERMS };
  const before = bot.calls.length;
  await command(bot, 'setup', admin);
  for (const section of ['overview', 'channels', 'leveling', 'economy', 'events', 'community', 'roles', 'depot']) {
    await component(bot, 'setup:nav', { ...admin, values: [section], componentType: 3 });
  }
  const { GROUPS } = bot.services.setupUi;
  for (const key of Object.keys(GROUPS)) {
    await component(bot, `setup:edit:${key}`, admin);
    const m = lastResponse(bot);
    assert.equal(m.type, 9, `${key} modal`);
    // Submit the modal back with its prefilled values (radio/checkbox defaults).
    const fields = {};
    m.data.components.forEach((l) => {
      const c = l.component;
      if (c.type === 4) fields[c.custom_id] = c.value ?? '';
      else if (c.type === 21) fields[c.custom_id] = c.options.find((o) => o.default)?.value ?? c.options[0].value;
      else if (c.type === 22) fields[c.custom_id] = c.options.filter((o) => o.default).map((o) => o.value);
    });
    const comps = Object.entries(fields).map(([id, value], i) => ({ type: 18, id: i, component: Array.isArray(value) ? { type: 22, custom_id: id, values: value } : m.data.components[i].component.type === 21 ? { type: 21, custom_id: id, value } : { type: 4, custom_id: id, value } }));
    const raw = (await import('./helpers.js')).makeInteraction({ type: 5, data: { custom_id: `setup:save:${key}`, components: comps }, message: { id: '1', flags: 64 | 32768 }, ...admin });
    await bot.router.dispatch(raw);
    assert.match(textOf(lastResponse(bot)), /saved/, `${key} saved`);
  }
  // Channel select, multi-selects, rewards, multipliers, faction roles, depot editor.
  await component(bot, 'setup:ch:events.channelId', { ...admin, values: [CH.events], componentType: 8 });
  assert.equal(bot.settings.get(GUILD).events.channelId, CH.events);
  await component(bot, 'setup:ms:events.dropChannelIds', { ...admin, values: [CH.general], componentType: 8 });
  await component(bot, 'setup:rw:add', admin);
  await submitModal(bot, 'setup:rwsave', { level: '5', role: [ROLE.reward] }, admin);
  assert.deepEqual(bot.settings.get(GUILD).leveling.rewards, [{ level: 5, roleId: ROLE.reward }]);
  await component(bot, 'setup:mult', admin);
  await submitModal(bot, 'setup:cmsave', { ch: [CH.general], pct: '150' }, admin);
  assert.equal(bot.settings.get(GUILD).leveling.channelMultipliers[CH.general], 150);
  await submitModal(bot, 'setup:rmultsave', { role: [ROLE.staff], pct: '110' }, admin);
  await component(bot, 'setup:fr', admin);
  await submitModal(bot, 'setup:frsave', { inferno: [ROLE.inferno], rancor: [], flare: [], void: [], nebula: [] }, admin);
  assert.equal(bot.settings.get(GUILD).factions.roleIds.inferno, ROLE.inferno);
  await component(bot, 'setup:inew', admin);
  await submitModal(bot, 'setup:inewsave', { name: 'Veteran role', kind: 'role', price: '5000', desc: 'Shows your dedication', emoji: '🎖️' }, admin);
  const item = bot.services.catalog.list(GUILD, { includeDisabled: true }).find((i) => i.name === 'Veteran role');
  await component(bot, `setup:itoggle:${item.id}`, admin);
  assert.match(textOf(lastResponse(bot)), /Role missing/);
  await component(bot, `setup:ikind:${item.id}`, admin);
  await submitModal(bot, `setup:ikindsave:${item.id}`, { role: [ROLE.reward], days: '30' }, admin);
  await component(bot, `setup:ilimit:${item.id}`, admin);
  await submitModal(bot, `setup:ilimitsave:${item.id}`, { limit: '1', lperiod: 'monthly', stock: '', speriod: 'none' }, admin);
  await component(bot, `setup:itoggle:${item.id}`, admin);
  assert.equal(bot.services.catalog.get(GUILD, item.id).enabled, true);
  await component(bot, `setup:ibasic:${item.id}`, admin);
  await component(bot, `setup:idel:${item.id}`, admin);
  await component(bot, `setup:idel:${item.id}:yes`, admin);
  assert.equal(bot.services.catalog.get(GUILD, item.id), null);
  // Validation: bad values are rejected with a friendly message.
  const raw = (await import('./helpers.js')).makeInteraction({ type: 5, data: { custom_id: 'setup:save:chat', components: [0, 1, 2, 3, 4].map((i) => ({ type: 18, component: { type: 4, custom_id: `f${i}`, value: i === 0 ? '999' : '10' } })) }, message: { id: '1', flags: 64 | 32768 }, ...admin });
  await bot.router.dispatch(raw);
  assert.match(textOf(lastResponse(bot)), /must be a whole number|cannot exceed/);
  // Non-managers are refused.
  await command(bot, 'setup', { userId: oldUser(94) });
  assert.match(textOf(lastResponse(bot)), /Managers only/);
  noErrors(bot, before);
});

test('season rollover pays the ladder and resets season XP', async () => {
  const bot = createTestBot({ 'events.channelId': CH.events });
  const top = [oldUser(60), oldUser(61)];
  bot.services.leveling.addXp(GUILD, top[0], 900, { silent: true });
  bot.services.leveling.addXp(GUILD, top[1], 400, { silent: true });
  const state = bot.state.get(GUILD);
  bot.state.update(GUILD, { season_key: '2020-01', week_key: state.week_key ?? 1 });
  const b0 = bot.economy.balance(GUILD, top[0]);
  await bot.services.seasons.rollover(GUILD);
  assert.equal(bot.economy.balance(GUILD, top[0]), b0 + 3000);
  assert.equal(bot.members.get(GUILD, top[0]).season_xp, 0);
  assert.equal(bot.state.get(GUILD).season_no, 2);
  assert.ok(bot.members.get(GUILD, top[0]).xp >= 900, 'lifetime XP kept');
});

test('user context menu and unknown/expired panels', async () => {
  const bot = createTestBot();
  const u = oldUser(70);
  const target = oldUser(71);
  const raw = (await import('./helpers.js')).makeInteraction({ type: 2, data: { id: '1', name: 'View Commander ID', type: 2, target_id: target, resolved: { users: { [target]: { id: target, username: 't' } } } }, userId: u });
  await bot.router.dispatch(raw);
  assert.equal(lastResponse(bot).data.flags & 64, 64);
  await component(bot, 'nonexistent:thing', { userId: u });
  assert.match(textOf(lastResponse(bot)), /expired/);
  noErrors(bot, 0);
  assert.ok(BOT_ID);
});
