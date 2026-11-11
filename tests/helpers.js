// Test harness: an in-memory bot with a mocked REST layer and a synthetic guild in the cache.
import { Logger } from '../src/core/logger.js';
import { Bot } from '../src/bot.js';
import { registerFeatures } from '../src/features/index.js';
import { validateMessage, validateModal } from '../src/core/components.js';

export const GUILD = '100000000000000001';
export const BOT_ID = '200000000000000002';
export const OWNER = '300000000000000003';
export const CH = { general: '400000000000000001', events: '400000000000000002', queue: '400000000000000003', log: '400000000000000004', voice: '400000000000000005' };
export const ROLE = { bot: '500000000000000001', staff: '500000000000000002', reward: '500000000000000003', inferno: '500000000000000004' };
// VIEW | SEND | EMBED | ATTACH | HISTORY | EXTERNAL EMOJI | MANAGE_ROLES
const EVERYONE_PERMS = String((1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 15n) | (1n << 16n) | (1n << 18n) | (1n << 6n));
const BOT_PERMS = String((1n << 28n) | (1n << 10n) | (1n << 11n));
let snow = 600000000000000000n;
export const nextId = () => String(snow++);
/** A user id whose snowflake timestamp is old enough for account-age checks. */
export const oldUser = (n) => String(((BigInt(Date.now() - 400 * 86_400_000) - 1420070400000n) << 22n) + BigInt(n));

/** @param {Record<string, any>} [overrides] settings path → value, e.g. { 'events.channelId': CH.events } */
export function createTestBot(overrides = {}) {
  const log = new Logger({ level: 'silent' });
  const config = { token: 'test.token.value', applicationId: BOT_ID, databasePath: ':memory:', intents: { messageContent: true, guildMembers: true }, http: {}, log: {}, userAgent: 'test', version: 'test', commandScope: 'global', syncCommands: false };
  const bot = new Bot(config, log);
  bot.contentIntent = true;
  bot.membersIntent = true;
  const calls = [];
  bot.calls = calls;
  bot.rest.request = async (method, path, opts = {}) => {
    calls.push({ method, path, body: opts.body });
    if (method === 'POST' && /^\/channels\/\d+\/messages$/.test(path)) return { id: nextId(), channel_id: path.split('/')[2] };
    if (method === 'POST' && path === '/users/@me/channels') return { id: nextId() };
    if (method === 'GET' && path.endsWith('/messages/@original')) return { id: nextId() };
    if (method === 'GET' && /^\/guilds\/\d+\/members\/\d+$/.test(path)) return { user: { id: path.split('/')[4], username: 'fetched' }, roles: [] };
    if (method === 'GET' && /^\/channels\/\d+$/.test(path)) return null;
    return null;
  };
  registerFeatures(bot);
  bot.cache.user = { id: BOT_ID, username: 'Sanctuary Core', bot: true };
  bot.cache.handle('GUILD_CREATE', {
    id: GUILD, name: 'Test Sanctuary', owner_id: OWNER, member_count: 42,
    roles: [
      { id: GUILD, name: '@everyone', permissions: EVERYONE_PERMS, position: 0 },
      { id: ROLE.bot, name: 'Sanctuary Core', permissions: BOT_PERMS, position: 10, managed: true },
      { id: ROLE.staff, name: 'Staff', permissions: '0', position: 5 },
      { id: ROLE.reward, name: 'Pioneer', permissions: '0', position: 3 },
      { id: ROLE.inferno, name: 'Inferno', permissions: '0', position: 2 },
    ],
    channels: [
      { id: CH.general, type: 0, name: 'general', permission_overwrites: [] },
      { id: CH.events, type: 0, name: 'events', permission_overwrites: [] },
      { id: CH.queue, type: 0, name: 'requisitions', permission_overwrites: [] },
      { id: CH.log, type: 0, name: 'staff-log', permission_overwrites: [] },
      { id: CH.voice, type: 2, name: 'Lounge', permission_overwrites: [] },
    ],
    members: [{ user: { id: BOT_ID, username: 'Sanctuary Core', bot: true }, roles: [ROLE.bot] }],
    voice_states: [],
  });
  for (const [path, value] of Object.entries(overrides)) bot.settings.set(GUILD, path, value);
  return bot;
}

/** Collected interaction callbacks for the last dispatch. */
export function callbacks(bot, since = 0) {
  return bot.calls.slice(since).filter((c) => c.path.startsWith('/interactions/') || c.path.startsWith('/webhooks/'));
}

/** Validate every message/modal payload the bot produced since `since`. */
export function payloadProblems(bot, since = 0) {
  const problems = [];
  for (const c of bot.calls.slice(since)) {
    if (!c.body) continue;
    let payload = null;
    let isModal = false;
    if (c.path.startsWith('/interactions/')) {
      if (c.body.type === 9) { payload = c.body.data; isModal = true; } else if ([4, 7].includes(c.body.type)) payload = c.body.data;
    } else if (/\/messages(\/\d+|\/@original)?$/.test(c.path) || /^\/webhooks\/\d+\/[^/]+$/.test(c.path)) payload = c.body;
    if (!payload || (!payload.components && !payload.embeds && !payload.content)) continue;
    const errs = isModal ? validateModal(payload) : validateMessage(payload);
    if (errs.length) problems.push(`${c.method} ${c.path}${payload.custom_id ? ` (${payload.custom_id})` : ''}: ${errs.join('; ')}`);
  }
  return problems;
}

let interactionCounter = 0;
export function makeInteraction({ type, data, userId = oldUser(1), roles = [], permissions = '0', message = null, channelId = CH.general }) {
  interactionCounter += 1;
  return {
    id: nextId(),
    application_id: BOT_ID,
    type,
    data,
    guild_id: GUILD,
    channel_id: channelId,
    member: { user: { id: userId, username: `user${userId.slice(-3)}`, global_name: null, avatar: null }, roles, permissions, nick: null },
    token: `token${interactionCounter}`.padEnd(80, 'x'),
    version: 1,
    app_permissions: '2251799813685247',
    locale: 'en-US',
    message,
  };
}

export const MANAGER_PERMS = String(1n << 5n);

/** Run a slash command: `cmd('shop')`, `cmd('staff', 'adjust', [{name, value, type}])`. */
export async function command(bot, name, { sub, options = [], ...rest } = {}) {
  const opts = sub ? [{ type: 1, name: sub, options }] : options;
  const raw = makeInteraction({ type: 2, data: { id: nextId(), name, type: 1, options: opts, resolved: rest.resolved }, ...rest });
  await bot.router.dispatch(raw);
  return raw;
}

export async function component(bot, customId, { values, componentType = 2, ephemeral = true, ...rest } = {}) {
  const raw = makeInteraction({ type: 3, data: { custom_id: customId, component_type: componentType, values }, message: { id: nextId(), flags: ephemeral ? (1 << 6) | (1 << 15) : 1 << 15, channel_id: rest.channelId || CH.general }, ...rest });
  await bot.router.dispatch(raw);
  return raw;
}

export async function submitModal(bot, customId, fields, { fromMessage = true, ...rest } = {}) {
  const components = Object.entries(fields).map(([id, value], i) => ({
    type: 18,
    id: i + 1,
    component: Array.isArray(value) ? { type: 3, custom_id: id, values: value } : typeof value === 'boolean' ? { type: 23, custom_id: id, value } : { type: 4, custom_id: id, value },
  }));
  const raw = makeInteraction({ type: 5, data: { custom_id: customId, components }, message: fromMessage ? { id: nextId(), flags: (1 << 6) | (1 << 15) } : null, ...rest });
  await bot.router.dispatch(raw);
  return raw;
}

/** Last interaction callback body (type + data). */
export function lastResponse(bot) {
  const list = bot.calls.filter((c) => c.path.startsWith('/interactions/') || c.path.includes('/messages/@original') || /^\/webhooks\/\d+\/[^/]+$/.test(c.path));
  return list[list.length - 1]?.body;
}

export function textOf(payload) {
  const out = [];
  const visit = (c) => {
    if (!c) return;
    if (c.type === 10) out.push(c.content);
    if (c.components) c.components.forEach(visit);
    if (c.accessory) visit(c.accessory);
    if (c.component) visit(c.component);
  };
  (payload?.components || payload?.data?.components || []).forEach(visit);
  if (payload?.data?.content) out.push(payload.data.content);
  if (payload?.embeds) out.push(...payload.embeds.map((e) => `${e.title} ${e.description || ''}`));
  return out.join('\n');
}

export function messageCreate(bot, { userId = oldUser(1), content = 'hello there commanders, how is everyone doing today?', channelId = CH.general, roles = [], referenced = null } = {}) {
  const msg = {
    id: nextId(), channel_id: channelId, guild_id: GUILD, type: referenced ? 19 : 0, content,
    author: { id: userId, username: `user${userId.slice(-3)}`, bot: false },
    member: { roles, nick: null }, attachments: [], sticker_items: [],
    message_reference: referenced ? { message_id: referenced.id, type: 0 } : undefined,
    referenced_message: referenced || undefined,
  };
  return bot.services.leveling.onMessage(msg).then(() => msg);
}
