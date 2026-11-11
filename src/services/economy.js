// Core Shards wallet with an append-only ledger. All balance changes are atomic.
import { UserError } from '../core/interactions.js';

export class InsufficientFunds extends UserError {
  constructor(needed, balance, currency) {
    super(`You need ${currency.long(needed)} but only have ${currency.fmt(balance)}.`, { title: 'Not enough shards', tone: 'warning' });
    this.needed = needed;
    this.balance = balance;
  }
}

// Ledger kinds that are not "earnings" (excluded from lifetime earned stats).
const NON_EARNING = new Set(['refund', 'admin', 'duel_refund', 'escrow_return']);

export class Economy {
  constructor(bot) {
    this.bot = bot;
  }

  get db() {
    return this.bot.db;
  }

  balance(guildId, userId) {
    return this.bot.members.get(guildId, userId)?.shards ?? 0;
  }

  #ledger(guildId, userId, currency, delta, balance, kind, { reason = null, actor = null, ref = null } = {}) {
    this.db.run(
      'INSERT INTO ledger (guild_id, user_id, currency, delta, balance, kind, reason, actor_id, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      guildId, userId, currency, delta, balance, kind, reason, actor, ref === null ? null : String(ref), Date.now(),
    );
  }

  /** Add shards. `log: false` skips the ledger row (used for high-frequency chat/voice trickles). */
  credit(guildId, userId, amount, kind, { reason, actor, ref, log = true } = {}) {
    const n = Math.floor(amount);
    if (!(n > 0)) return this.balance(guildId, userId);
    return this.db.tx(() => {
      this.bot.members.ensure(guildId, userId);
      this.db.run(
        'UPDATE members SET shards = shards + ?, shards_earned = shards_earned + ?, updated_at = ? WHERE guild_id = ? AND user_id = ?',
        n, NON_EARNING.has(kind) ? 0 : n, Date.now(), guildId, userId,
      );
      const balance = this.balance(guildId, userId);
      if (log) this.#ledger(guildId, userId, 'shards', n, balance, kind, { reason, actor, ref });
      return balance;
    });
  }

  /** Remove shards or throw InsufficientFunds. */
  debit(guildId, userId, amount, kind, { reason, actor, ref } = {}) {
    const n = Math.floor(amount);
    if (!(n > 0)) return this.balance(guildId, userId);
    return this.db.tx(() => {
      const row = this.bot.members.ensure(guildId, userId);
      if (row.shards < n) throw new InsufficientFunds(n, row.shards, this.bot.settings.currency(guildId));
      this.db.run('UPDATE members SET shards = shards - ?, updated_at = ? WHERE guild_id = ? AND user_id = ?', n, Date.now(), guildId, userId);
      const balance = row.shards - n;
      this.#ledger(guildId, userId, 'shards', -n, balance, kind, { reason, actor, ref });
      return balance;
    });
  }

  /** Staff adjustment; removals are clamped at zero. Returns the applied delta and new balance. */
  adjust(guildId, userId, delta, { reason, actor } = {}) {
    return this.db.tx(() => {
      const row = this.bot.members.ensure(guildId, userId);
      const applied = delta < 0 ? -Math.min(row.shards, Math.abs(Math.floor(delta))) : Math.floor(delta);
      if (!applied) return { applied: 0, balance: row.shards };
      this.db.run('UPDATE members SET shards = shards + ?, updated_at = ? WHERE guild_id = ? AND user_id = ?', applied, Date.now(), guildId, userId);
      const balance = row.shards + applied;
      this.#ledger(guildId, userId, 'shards', applied, balance, 'admin', { reason, actor });
      return { applied, balance };
    });
  }

  logXp(guildId, userId, delta, total, kind, opts = {}) {
    this.#ledger(guildId, userId, 'xp', delta, total, kind, opts);
  }

  history(guildId, userId, limit = 10) {
    return this.db.all('SELECT * FROM ledger WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?', guildId, userId, limit);
  }
}
