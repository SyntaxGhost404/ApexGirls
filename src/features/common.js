// Shared helpers for feature modules.
import { UserError } from '../core/interactions.js';
import { button, row, ButtonStyle } from '../core/components.js';
import { ICON } from '../content/theme.js';
import { displayName } from '../util/format.js';

export function requireGuild(ctx) {
  if (!ctx.guildId) throw new UserError('This only works inside the server.', { title: 'Server only' });
  return ctx.guildId;
}

/** Staff = Manage Server / Administrator, or one of the configured staff roles. */
export function isStaff(bot, ctx) {
  if (ctx.isManager) return true;
  const roles = bot.settings.get(ctx.guildId).general.staffRoleIds || [];
  return ctx.memberRoles.some((r) => roles.includes(r));
}

export function requireStaff(bot, ctx) {
  requireGuild(ctx);
  if (!isStaff(bot, ctx)) throw new UserError('This control is reserved for the server staff team.', { title: 'Staff only' });
}

/** Event hosts may run giveaways/events; staff always can. */
export function isHost(bot, ctx) {
  if (isStaff(bot, ctx)) return true;
  const roles = bot.settings.get(ctx.guildId).giveaways.hostRoleIds || [];
  return ctx.memberRoles.some((r) => roles.includes(r));
}

/** Panels encode their owner in the custom id; other members get their own copy instead. */
export function isOwner(ctx, ownerId) {
  return !ownerId || ownerId === ctx.userId;
}

export function nameOf(bot, guildId, userId, fallbackUser) {
  const m = bot.cache.member(guildId, userId);
  if (m) return displayName({ username: m.username, global_name: m.globalName }, { nick: m.nick });
  return displayName(fallbackUser);
}

/** Standard pagination row: ⏮ ◀ [center] ▶ ⏭ with ids `${base}:${page}`. */
export function pager(base, page, pages, { center } = {}) {
  const last = Math.max(0, pages - 1);
  return row(
    button({ id: `${base}:0:f`, emoji: ICON.first, disabled: page <= 0 }),
    button({ id: `${base}:${Math.max(0, page - 1)}:p`, emoji: ICON.prev, disabled: page <= 0 }),
    center || button({ id: `${base}:${page}:r`, emoji: ICON.refresh, style: ButtonStyle.Secondary }),
    button({ id: `${base}:${Math.min(last, page + 1)}:n`, emoji: ICON.next, disabled: page >= last }),
    button({ id: `${base}:${last}:l`, emoji: ICON.last, disabled: page >= last }),
  );
}

export function clampInt(value, min, max) {
  const n = Number.parseInt(String(value).replace(/[,_\s]/g, ''), 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/** Parse an integer from a modal field, throwing a friendly error when invalid. */
export function intField(ctx, id, label, min, max) {
  const raw = String(ctx.field(id, '') ?? '').trim();
  const n = Number.parseInt(raw.replace(/[,_\s]/g, ''), 10);
  if (!Number.isFinite(n) || String(n) !== raw.replace(/[,_\s]/g, '').replace(/^\+/, '').replace(/^0+(?=\d)/, '')) {
    throw new UserError(`**${label}** must be a whole number between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}.`, { title: 'Invalid value', tone: 'warning' });
  }
  if (n < min || n > max) throw new UserError(`**${label}** must be between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}.`, { title: 'Invalid value', tone: 'warning' });
  return n;
}
