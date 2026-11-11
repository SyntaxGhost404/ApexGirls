// Supply Depot data layer: catalogue, limits/stock windows and atomic purchases.
import { UserError } from '../../core/interactions.js';
import { DEFAULT_SHOP } from '../../content/defaults.js';
import { periodStart } from '../../util/time.js';
import { levelFor } from '../leveling/curve.js';
import { SHIELD_KEY } from '../daily.js';

export const KINDS = ['title', 'accent', 'role', 'consumable', 'fulfillment'];

export function parseItem(row) {
  if (!row) return null;
  let data = {};
  try {
    data = JSON.parse(row.data || '{}');
  } catch {
    data = {};
  }
  return { ...row, data, enabled: Boolean(row.enabled) };
}

/** Inventory key an item is stored under (null when it is not stored). */
export function inventoryKey(item) {
  switch (item.kind) {
    case 'title': return `title:${item.id}`;
    case 'accent': return `accent:${item.id}`;
    case 'consumable': return item.data.effect === 'streak_shield' ? SHIELD_KEY : `boost:${item.id}`;
    default: return null;
  }
}

export class Catalog {
  constructor(bot) {
    this.bot = bot;
  }

  get db() {
    return this.bot.db;
  }

  /** Seed the starter catalogue the first time a guild opens the depot. */
  seed(guildId) {
    if (this.db.kvGet(`shop.seeded.${guildId}`)) return;
    const now = Date.now();
    this.db.tx(() => {
      DEFAULT_SHOP.forEach((item, i) => {
        this.db.run(
          `INSERT INTO shop_items (guild_id, kind, name, description, emoji, price, stock, stock_period, limit_count, limit_period, min_level, role_id, data, enabled, sort, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
          guildId, item.kind, item.name, item.description || '', item.emoji || null, item.price, item.stock ?? null, item.stock_period || 'none',
          item.limit_count ?? null, item.limit_period || 'none', item.min_level || 0, JSON.stringify(item.data || {}), item.enabled === false ? 0 : 1, (i + 1) * 10, now, now,
        );
      });
      this.db.kvSet(`shop.seeded.${guildId}`, true);
    });
  }

  list(guildId, { kind = null, includeDisabled = false } = {}) {
    this.seed(guildId);
    const rows = this.db.all('SELECT * FROM shop_items WHERE guild_id = ? ORDER BY sort, id', guildId).map(parseItem);
    return rows.filter((r) => (includeDisabled || r.enabled) && (!kind || r.kind === kind));
  }

  get(guildId, id) {
    return parseItem(this.db.get('SELECT * FROM shop_items WHERE guild_id = ? AND id = ?', guildId, Number(id)));
  }

  create(guildId, fields) {
    const now = Date.now();
    const sort = (this.db.get('SELECT MAX(sort) AS s FROM shop_items WHERE guild_id = ?', guildId)?.s || 0) + 10;
    const res = this.db.run(
      `INSERT INTO shop_items (guild_id, kind, name, description, emoji, price, stock, stock_period, limit_count, limit_period, min_level, role_id, data, enabled, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      guildId, fields.kind, fields.name, fields.description || '', fields.emoji || null, fields.price, fields.stock ?? null, fields.stock_period || 'none',
      fields.limit_count ?? null, fields.limit_period || 'none', fields.min_level || 0, fields.role_id || null, JSON.stringify(fields.data || {}), fields.enabled ? 1 : 0, sort, now, now,
    );
    return this.get(guildId, Number(res.lastInsertRowid));
  }

  update(guildId, id, fields) {
    const allowed = ['kind', 'name', 'description', 'emoji', 'price', 'stock', 'stock_period', 'limit_count', 'limit_period', 'min_level', 'role_id', 'data', 'enabled', 'sort'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return this.get(guildId, id);
    const values = keys.map((k) => (k === 'data' ? JSON.stringify(fields[k]) : k === 'enabled' ? (fields[k] ? 1 : 0) : fields[k]));
    this.db.run(`UPDATE shop_items SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE guild_id = ? AND id = ?`, ...values, Date.now(), guildId, Number(id));
    return this.get(guildId, id);
  }

  remove(guildId, id) {
    this.db.run('DELETE FROM shop_items WHERE guild_id = ? AND id = ?', guildId, Number(id));
  }

  /** Units bought by a member within the item's limit window. */
  boughtBy(guildId, userId, item, now = Date.now()) {
    if (!item.limit_count || item.limit_period === 'none') return 0;
    const since = periodStart(item.limit_period, now, this.bot.settings.get(guildId).general.resetHour);
    return this.db.get("SELECT COALESCE(SUM(quantity), 0) AS n FROM purchases WHERE guild_id = ? AND user_id = ? AND item_id = ? AND status != 'refunded' AND created_at >= ?", guildId, userId, item.id, since).n;
  }

  /** Units sold to everyone within the stock window (null when stock is unlimited). */
  sold(guildId, item, now = Date.now()) {
    if (item.stock === null || item.stock === undefined) return null;
    const since = item.stock_period === 'none' ? 0 : periodStart(item.stock_period, now, this.bot.settings.get(guildId).general.resetHour);
    return this.db.get("SELECT COALESCE(SUM(quantity), 0) AS n FROM purchases WHERE guild_id = ? AND item_id = ? AND status != 'refunded' AND created_at >= ?", guildId, item.id, since).n;
  }

  owns(guildId, userId, item) {
    const key = inventoryKey(item);
    if (!key || item.kind === 'consumable') return false;
    return Boolean(this.db.get('SELECT quantity FROM inventory WHERE guild_id = ? AND user_id = ? AND item_key = ? AND quantity > 0', guildId, userId, key));
  }

  /** Why a member cannot buy `qty` of an item right now (null when they can). */
  blocker(guildId, userId, item, qty = 1, { memberRoles = null } = {}) {
    if (!item || !item.enabled) return 'This item is no longer stocked.';
    const rec = this.bot.members.ensure(guildId, userId);
    const level = levelFor(rec.xp, this.bot.settings.get(guildId).leveling.curveScale);
    if (level < item.min_level) return `Requires **level ${item.min_level}** (you are level ${level}).`;
    if (this.owns(guildId, userId, item)) return 'You already own this.';
    if (item.kind === 'role') {
      if (!item.role_id) return 'This role reward is not configured yet.';
      if (memberRoles?.includes(item.role_id)) return 'You already have this role.';
    }
    if (item.limit_count && item.limit_period !== 'none') {
      const bought = this.boughtBy(guildId, userId, item);
      if (bought + qty > item.limit_count) return `Purchase limit reached (${bought}/${item.limit_count} ${item.limit_period === 'lifetime' ? 'total' : `this ${item.limit_period.replace('ly', '').replace('dai', 'day')}`}).`;
    }
    const sold = this.sold(guildId, item);
    if (sold !== null && sold + qty > item.stock) return item.stock - sold > 0 ? `Only ${item.stock - sold} left in stock.` : 'Sold out — stock refreshes with the next window.';
    if (rec.shards < item.price * qty) return `Not enough ${this.bot.settings.currency(guildId).name} (${rec.shards.toLocaleString('en-US')} / ${(item.price * qty).toLocaleString('en-US')}).`;
    return null;
  }

  /**
   * Atomic purchase. Returns { purchaseId, item, qty, total, balance }.
   * Granting roles / filing requisitions happens in the caller (needs network).
   */
  purchase(guildId, userId, itemId, qty = 1, { memberRoles = null } = {}) {
    return this.db.tx(() => {
      const item = this.get(guildId, itemId);
      const why = this.blocker(guildId, userId, item, qty, { memberRoles });
      if (why) throw new UserError(why, { title: 'Purchase unavailable', tone: 'warning' });
      const total = item.price * qty;
      const balance = this.bot.economy.debit(guildId, userId, total, 'purchase', { reason: `${qty}× ${item.name}`, ref: item.id });
      const res = this.db.run('INSERT INTO purchases (guild_id, user_id, item_id, quantity, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', guildId, userId, item.id, qty, total, 'complete', Date.now());
      const key = inventoryKey(item);
      if (key) {
        const data = item.kind === 'title' ? { title: item.data.title || item.name } : item.kind === 'accent' ? { color: item.data.color } : item.data;
        this.db.run(
          `INSERT INTO inventory (guild_id, user_id, item_key, quantity, data, acquired_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(guild_id, user_id, item_key) DO UPDATE SET quantity = quantity + excluded.quantity, data = excluded.data`,
          guildId, userId, key, qty, JSON.stringify({ ...data, name: item.name, emoji: item.emoji }), Date.now(),
        );
      }
      return { purchaseId: Number(res.lastInsertRowid), item, qty, total, balance };
    });
  }

  refund(guildId, purchaseId, reason) {
    return this.db.tx(() => {
      const p = this.db.get("SELECT * FROM purchases WHERE guild_id = ? AND id = ? AND status != 'refunded'", guildId, purchaseId);
      if (!p) return null;
      this.db.run("UPDATE purchases SET status = 'refunded' WHERE id = ?", purchaseId);
      return this.bot.economy.credit(guildId, p.user_id, p.total, 'refund', { reason, ref: p.item_id });
    });
  }
}
