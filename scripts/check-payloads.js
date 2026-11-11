// Live payload verification: runs a scripted tour of every feature against an in-memory bot,
// records every message payload it produced, then posts each distinct payload to a test channel
// so Discord's API validates it for real. Messages are deleted immediately and sent with
// notifications suppressed and no mentions.
//
//   npm run check-payloads -- <test-channel-id> [--dry]
import { loadEnvFile, loadConfig } from '../src/config.js';
import { Logger, addRedaction } from '../src/core/logger.js';
import { RestClient, DiscordAPIError } from '../src/core/rest.js';
import { MessageFlags, validateMessage } from '../src/core/components.js';
import { createTestBot, command, component, submitModal, messageCreate, oldUser, GUILD, CH, ROLE, MANAGER_PERMS } from '../tests/helpers.js';
import { totalXpForLevel } from '../src/features/leveling/curve.js';

loadEnvFile();
const { config, errors } = loadConfig();
const log = new Logger({ level: 'info', scope: 'check' });
addRedaction(config.token);
const channelId = process.argv[2];
if (errors.length || !/^\d{16,20}$/.test(channelId || '')) {
  log.error('usage: npm run check-payloads -- <test-channel-id>   (requires DISCORD_TOKEN)');
  process.exit(1);
}

// 1) Tour every feature with a mocked REST layer, recording payloads.
const bot = createTestBot({ 'events.channelId': CH.events, 'shop.requisitionChannelId': CH.queue, 'general.logChannelId': CH.log, 'welcome.enabled': true, 'welcome.channelId': CH.general, 'leveling.rewards': [{ level: 1, roleId: ROLE.reward }] });
const staff = { userId: oldUser(900), permissions: MANAGER_PERMS };
const users = Array.from({ length: 6 }, (_, i) => oldUser(100 + i));
for (const [i, u] of users.entries()) {
  bot.services.leveling.addXp(GUILD, u, 400 * (i + 1) ** 2, { silent: true });
  bot.economy.credit(GUILD, u, 20_000, 'seed');
}
const me = users[0];
const step = async (name, fn) => {
  try {
    await fn();
  } catch (err) {
    log.warn(`scenario step "${name}" threw: ${err.message}`);
  }
};

await step('commands', async () => {
  for (const name of ['profile', 'leaderboard', 'daily', 'quests', 'shop', 'inventory', 'faction', 'expedition', 'help', 'archive', 'codes']) await command(bot, name, { userId: me });
  for (const topic of ['progression', 'economy', 'events', 'game', 'staff']) await component(bot, 'help:topic', { userId: me, values: [topic], componentType: 3 });
  for (const topic of ['mechs', 'stellari', 'sanctuaries', 'factions', 'classes', 'echo', 'companions', 'noah', 'codes']) await component(bot, 'arch:topic', { userId: me, values: [topic], componentType: 3 });
  for (let s = 0; s < 4; s += 1) await component(bot, `help:brief:${s}`, { userId: me });
  await component(bot, 'help:done', { userId: me });
  for (const lb of ['lifetime', 'weekly', 'shards', 'voice', 'streak']) await component(bot, `lb:board:${me}`, { userId: me, values: [lb], componentType: 3 });
});
await step('profile', async () => {
  await submitModal(bot, 'prof:dossier', { bio: 'Void main. Breach enjoyer.', main: 'Tsubaki', ping: true }, { userId: me });
  await submitModal(bot, 'prof:linksave', { region: 'global', server: 'S12', uid: '12345678', public: false }, { userId: me });
});
await step('chat + level up', async () => {
  const u = oldUser(150);
  bot.members.ensure(GUILD, u);
  bot.members.update(GUILD, u, { xp: totalXpForLevel(5) - 1 });
  await messageCreate(bot, { userId: u, content: 'who else is saving echo permits for the next limited banner?' });
  await new Promise((r) => setTimeout(r, 50));
});
await step('shop', async () => {
  const items = bot.services.catalog.list(GUILD);
  const title = items.find((i) => i.kind === 'title');
  const booster = items.find((i) => i.data.effect === 'xp_boost');
  await component(bot, `shop:item:${title.id}:all:0`, { userId: me });
  await component(bot, `shop:buy:${title.id}:all:0`, { userId: me });
  await component(bot, `shop:confirm:${title.id}:1:all:0`, { userId: me });
  await component(bot, `shop:confirm:${booster.id}:1:all:0`, { userId: me });
  await component(bot, 'inv:open', { userId: me });
  const reward = bot.services.catalog.list(GUILD, { includeDisabled: true }).find((i) => i.kind === 'fulfillment');
  bot.services.catalog.update(GUILD, reward.id, { enabled: true, min_level: 0 });
  await submitModal(bot, `shop:req:${reward.id}`, { region: 'sea', server: 'S3', uid: '88776655', note: 'Thank you!' }, { userId: me });
  await component(bot, 'inv:reqs', { userId: me });
  await component(bot, 'req:ok:1', { ...staff, ephemeral: false });
});
await step('factions', async () => {
  await component(bot, 'fac:pledge:void', { userId: me });
  for (const [i, u] of users.slice(1).entries()) await component(bot, `fac:pledge:${['inferno', 'rancor', 'flare', 'nebula', 'void'][i]}`, { userId: u });
  bot.services.leveling.addXp(GUILD, me, 300, { silent: true });
  await bot.services.factions.finalizeWeek(GUILD, bot.services.factions.week(GUILD));
});
await step('events', async () => {
  await command(bot, 'staff', { sub: 'event', options: [{ name: 'type', type: 3, value: 'breach' }], ...staff });
  const br = bot.services.events.active(GUILD, 'breach')[0];
  await component(bot, `br:hit:${br.id}:a`, { userId: users[1], ephemeral: false });
  await component(bot, `br:hit:${br.id}:s`, { userId: users[2], ephemeral: false });
  await component(bot, `br:intel:${br.id}`, { userId: users[3], ephemeral: false });
  bot.calls.push({ method: 'POST', path: `/channels/${CH.events}/messages`, body: bot.services.events.render(bot.services.events.get(br.id)) });
  await bot.services.events.end(br.id);
  await command(bot, 'staff', { sub: 'event', options: [{ name: 'type', type: 3, value: 'drop' }], ...staff });
  const drop = bot.services.events.active(GUILD, 'drop')[0];
  await component(bot, `drop:claim:${drop.id}`, { userId: users[1], ephemeral: false });
  await bot.services.events.end(drop.id);
  await command(bot, 'staff', { sub: 'event', options: [{ name: 'type', type: 3, value: 'trivia' }], ...staff });
  const tr = bot.services.events.active(GUILD, 'trivia')[0];
  await component(bot, `triv:ans:${tr.id}:${tr.state.correct}`, { userId: users[2], ephemeral: false });
  await bot.services.events.end(tr.id);
  await command(bot, 'staff', { sub: 'event', options: [{ name: 'type', type: 3, value: 'surge' }, { name: 'percent', type: 4, value: 150 }], ...staff });
});
await step('giveaway', async () => {
  await submitModal(bot, `gw:create:${CH.general}:0:100:1`, { prize: 'Advanced Echo Permit ×5', winners: '1', duration: '1h', level: '0', desc: 'Celebrating the Carnival Season!' }, { ...staff, fromMessage: false });
  for (const u of users.slice(0, 3)) await component(bot, 'gw:enter:1', { userId: u, ephemeral: false });
  await component(bot, 'gw:odds:1', { userId: me, ephemeral: false });
  await bot.services.giveaways.end(1);
  await command(bot, 'giveaway', { sub: 'list', ...staff });
});
await step('expedition + duel', async () => {
  await component(bot, 'exp:go', { userId: me, values: ['recon'], componentType: 3 });
  bot.db.run('UPDATE expeditions SET ends_at = 0');
  await component(bot, 'exp:claim', { userId: me });
  await component(bot, 'exp:relics', { userId: me });
  const b = users[1];
  await command(bot, 'duel', { options: [{ name: 'opponent', type: 6, value: b }, { name: 'stake', type: 4, value: 100 }], resolved: { users: { [b]: { id: b, username: 'b' } } }, userId: me });
  await component(bot, 'duel:accept:1', { userId: b, ephemeral: false });
  await component(bot, 'duel:lock:1', { userId: me, ephemeral: false });
  await component(bot, 'duel:pick:1:void', { userId: me });
  await component(bot, 'duel:pick:1:inferno', { userId: b });
});
await step('staff', async () => {
  await command(bot, 'staff', { sub: 'inspect', options: [{ name: 'member', type: 6, value: me }], resolved: { users: { [me]: { id: me, username: 'me' } } }, ...staff });
  await command(bot, 'staff', { sub: 'requisitions', ...staff });
  await submitModal(bot, 'staff:codesave', { code: 'AGM134', rewards: '300 Diamonds · 5 Echo Permits', expires: '7d', region: 'all' }, staff);
  await submitModal(bot, 'staff:trivsave', { q: 'Which city-state is protected by three walls?', a0: 'Pax', a1: 'Trelinton', a2: 'Iris-9', a3: 'Azure' }, staff);
  await command(bot, 'staff', { sub: 'season', ...staff });
  await component(bot, 'staff:seasonend:x:yes', staff);
});
await step('setup', async () => {
  for (const s of ['overview', 'channels', 'leveling', 'economy', 'events', 'community', 'roles', 'depot']) await component(bot, 'setup:nav', { ...staff, values: [s], componentType: 3 });
  await component(bot, 'setup:mult', staff);
  const item = bot.services.catalog.list(GUILD, { includeDisabled: true })[0];
  await component(bot, 'setup:iedit', { ...staff, values: [String(item.id)], componentType: 3 });
});
await step('welcome', async () => {
  bot.cache.handle('GUILD_MEMBER_ADD', { guild_id: GUILD, user: { id: oldUser(777), username: 'newbie' }, roles: [] });
  for (const h of bot.handlers.get('GUILD_MEMBER_ADD') || []) h({ guild_id: GUILD, user: { id: oldUser(777), username: 'newbie' }, roles: [] });
  await new Promise((r) => setTimeout(r, 8_500));
});
for (const t of bot.services.events.renderTimers.values()) clearTimeout(t);
for (const t of bot.services.giveaways.renderTimers.values()) clearTimeout(t);

// 2) Extract distinct payloads.
const payloads = new Map();
for (const c of bot.calls) {
  let p = null;
  if (c.path.startsWith('/interactions/') && [4, 7].includes(c.body?.type)) p = c.body.data;
  else if (/^\/webhooks\/\d+\/[^/]+(\/messages\/@original)?$/.test(c.path) && c.body) p = c.body;
  else if (/^\/channels\/\d+\/messages(\/\d+)?$/.test(c.path) && ['POST', 'PATCH'].includes(c.method) && c.body) p = c.body;
  if (!p || (!p.components?.length && !p.embeds?.length && !p.content)) continue;
  const body = { ...p, flags: ((p.flags || 0) & MessageFlags.IsComponentsV2) | MessageFlags.SuppressNotifications, allowed_mentions: { parse: [] } };
  delete body.message_reference;
  const key = JSON.stringify(body);
  if (!payloads.has(key)) payloads.set(key, { body, source: `${c.method} ${c.path.replace(/\d{16,20}/g, ':id').replace(/token\w+/g, ':token')}` });
}
log.info(`scenario produced ${payloads.size} distinct message payloads; local validator: ${[...payloads.values()].filter((p) => validateMessage(p.body).length).length} with problems`);

if (process.argv.includes('--dry')) {
  for (const p of payloads.values()) {
    const errs = validateMessage(p.body);
    if (errs.length) log.warn(`${p.source}: ${errs.join('; ')}`);
  }
  bot.db.close();
  process.exit(0);
}

// 3) Post each to Discord for real validation, then delete.
const rest = new RestClient({ token: config.token, userAgent: config.userAgent, log: log.child('rest') });
let ok = 0;
const failures = [];
for (const { body, source } of payloads.values()) {
  try {
    const msg = await rest.post(`/channels/${channelId}/messages`, body);
    ok += 1;
    await rest.delete(`/channels/${channelId}/messages/${msg.id}`).catch((err) => log.warn(`delete failed: ${err.message}`));
  } catch (err) {
    // Show the offending value for each error path, e.g. components[0].components[1].emoji.name
    const values = (err.details || []).map((line) => {
      const path = line.split(':')[0];
      const value = path.split(/\.|\[|\]/).filter(Boolean).reduce((acc, k) => (acc === undefined ? undefined : acc[k]), body);
      return `${path} = ${JSON.stringify(value)}`;
    });
    failures.push({ source, error: `${err instanceof DiscordAPIError ? err.message : String(err)}${values.length ? `\n    → ${values.join('\n    → ')}` : ''}` });
    // Stop early on access problems instead of hammering the API with invalid requests.
    if (err instanceof DiscordAPIError && [401, 403, 404].includes(err.status)) {
      log.error(`aborting: ${err.apiMessage} — make sure the bot can view and send messages in <#${channelId}>`);
      break;
    }
  }
}
log.info(`Discord accepted ${ok}/${payloads.size} payloads`);
for (const f of failures) log.error(`REJECTED (${f.source}):\n${f.error}`);
bot.db.close();
process.exit(failures.length ? 1 : 0);
