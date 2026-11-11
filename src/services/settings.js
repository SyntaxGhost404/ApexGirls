// Per-guild settings (defaults deep-merged with stored overrides) and mutable guild state.
import { DEFAULT_SETTINGS } from '../content/defaults.js';

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? structuredClone(base) : structuredClone(override);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : structuredClone(v);
  }
  return out;
}

export function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isPlainObject(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
  return obj;
}

export class SettingsService {
  constructor(bot) {
    this.bot = bot;
    this.cache = new Map();
  }

  raw(guildId) {
    const row = this.bot.db.get('SELECT data FROM guild_settings WHERE guild_id = ?', guildId);
    return row ? JSON.parse(row.data) : {};
  }

  /** Effective settings for a guild. Treat the returned object as read-only. */
  get(guildId) {
    let s = this.cache.get(guildId);
    if (!s) {
      s = deepMerge(DEFAULT_SETTINGS, this.raw(guildId));
      this.cache.set(guildId, s);
    }
    return s;
  }

  #save(guildId, data) {
    this.bot.db.run(
      'INSERT INTO guild_settings (guild_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      guildId, JSON.stringify(data), Date.now(),
    );
    this.cache.delete(guildId);
  }

  set(guildId, path, value) {
    const data = this.raw(guildId);
    setPath(data, path, value);
    this.#save(guildId, data);
    return this.get(guildId);
  }

  /** Apply several path → value updates atomically. */
  setMany(guildId, entries) {
    const data = this.raw(guildId);
    for (const [path, value] of entries) setPath(data, path, value);
    this.#save(guildId, data);
    return this.get(guildId);
  }

  update(guildId, mutator) {
    const data = this.raw(guildId);
    const effective = deepMerge(DEFAULT_SETTINGS, data);
    mutator(effective);
    this.#save(guildId, effective);
    return this.get(guildId);
  }

  currency(guildId) {
    const { currencyName, currencyEmoji } = this.get(guildId).branding;
    return {
      name: currencyName,
      emoji: currencyEmoji,
      fmt: (n) => `${currencyEmoji} **${Number(n || 0).toLocaleString('en-US')}**`,
      long: (n) => `${currencyEmoji} **${Number(n || 0).toLocaleString('en-US')}** ${currencyName}`,
    };
  }
}

export class GuildStateService {
  constructor(bot) {
    this.bot = bot;
  }

  get(guildId) {
    let row = this.bot.db.get('SELECT * FROM guild_state WHERE guild_id = ?', guildId);
    if (!row) {
      this.bot.db.run('INSERT OR IGNORE INTO guild_state (guild_id, season_started_at) VALUES (?, ?)', guildId, Date.now());
      row = this.bot.db.get('SELECT * FROM guild_state WHERE guild_id = ?', guildId);
    }
    return row;
  }

  update(guildId, fields) {
    this.get(guildId);
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.bot.db.run(`UPDATE guild_state SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE guild_id = ?`, ...keys.map((k) => fields[k]), guildId);
  }

  /** Active XP surge multiplier (1 when none). */
  surge(guildId) {
    const s = this.get(guildId);
    return s.surge_until && s.surge_until > Date.now() && s.surge_mult ? s.surge_mult : 1;
  }
}
