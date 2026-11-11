// Member records (progression, wallet, profile, daily counters).

const COLUMNS = new Set([
  'xp', 'level', 'season_xp', 'weekly_xp', 'shards', 'shards_earned', 'messages', 'voice_minutes', 'last_xp_at',
  'day_key', 'day_chat_xp', 'day_voice_xp', 'day_chat_shards', 'day_expeditions', 'day_duels',
  'streak', 'best_streak', 'last_daily_day', 'daily_claims', 'faction', 'faction_since', 'title', 'accent', 'bio',
  'game_region', 'game_server', 'game_uid', 'uid_public', 'main_stellaris', 'boost_mult', 'boost_until',
  'levelup_ping', 'stats', 'onboarded', 'left_guild',
]);
const RANKABLE = new Set(['xp', 'season_xp', 'weekly_xp', 'shards', 'voice_minutes', 'best_streak', 'messages', 'shards_earned']);
const DAY_FIELDS = ['day_chat_xp', 'day_voice_xp', 'day_chat_shards', 'day_expeditions', 'day_duels'];

export class MemberService {
  constructor(bot) {
    this.bot = bot;
  }

  get db() {
    return this.bot.db;
  }

  get(guildId, userId) {
    return this.db.get('SELECT * FROM members WHERE guild_id = ? AND user_id = ?', guildId, userId);
  }

  ensure(guildId, userId) {
    const now = Date.now();
    this.db.run('INSERT OR IGNORE INTO members (guild_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)', guildId, userId, now, now);
    return this.get(guildId, userId);
  }

  update(guildId, userId, fields) {
    const keys = Object.keys(fields);
    for (const k of keys) if (!COLUMNS.has(k)) throw new Error(`unknown member column ${k}`);
    if (!keys.length) return;
    this.db.run(
      `UPDATE members SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE guild_id = ? AND user_id = ?`,
      ...keys.map((k) => fields[k]), Date.now(), guildId, userId,
    );
  }

  increment(guildId, userId, fields) {
    const keys = Object.keys(fields);
    for (const k of keys) if (!COLUMNS.has(k)) throw new Error(`unknown member column ${k}`);
    if (!keys.length) return;
    this.db.run(
      `UPDATE members SET ${keys.map((k) => `${k} = ${k} + ?`).join(', ')}, updated_at = ? WHERE guild_id = ? AND user_id = ?`,
      ...keys.map((k) => fields[k]), Date.now(), guildId, userId,
    );
  }

  /** Daily counters for `today`; stale counters read as zero. */
  day(row, today) {
    if (!row || row.day_key !== today) return Object.fromEntries([['day_key', today], ...DAY_FIELDS.map((f) => [f, 0]), ['stale', true]]);
    return Object.fromEntries([['day_key', today], ...DAY_FIELDS.map((f) => [f, row[f] || 0]), ['stale', false]]);
  }

  /** Increment daily counters, resetting them first if the stored day is stale. */
  bumpDay(guildId, userId, today, deltas) {
    const row = this.ensure(guildId, userId);
    const day = this.day(row, today);
    const next = { day_key: today };
    for (const f of DAY_FIELDS) next[f] = day[f] + (deltas[f] || 0);
    this.update(guildId, userId, next);
    return next;
  }

  stats(row) {
    try {
      return JSON.parse(row?.stats || '{}');
    } catch {
      return {};
    }
  }

  bumpStat(guildId, userId, key, n = 1) {
    const row = this.ensure(guildId, userId);
    const stats = this.stats(row);
    stats[key] = (stats[key] || 0) + n;
    this.update(guildId, userId, { stats: JSON.stringify(stats) });
    return stats[key];
  }

  rank(guildId, userId, column = 'xp') {
    if (!RANKABLE.has(column)) throw new Error(`cannot rank by ${column}`);
    const row = this.get(guildId, userId);
    if (!row || !row[column]) return null;
    return this.db.get(`SELECT COUNT(*) + 1 AS r FROM members WHERE guild_id = ? AND left_guild = 0 AND ${column} > ?`, guildId, row[column]).r;
  }

  top(guildId, column = 'xp', limit = 10, offset = 0) {
    if (!RANKABLE.has(column)) throw new Error(`cannot rank by ${column}`);
    return this.db.all(
      `SELECT * FROM members WHERE guild_id = ? AND left_guild = 0 AND ${column} > 0 ORDER BY ${column} DESC, xp DESC, user_id ASC LIMIT ? OFFSET ?`,
      guildId, limit, offset,
    );
  }

  count(guildId, column = 'xp') {
    if (!RANKABLE.has(column)) throw new Error(`cannot rank by ${column}`);
    return this.db.get(`SELECT COUNT(*) AS n FROM members WHERE guild_id = ? AND left_guild = 0 AND ${column} > 0`, guildId).n;
  }
}
