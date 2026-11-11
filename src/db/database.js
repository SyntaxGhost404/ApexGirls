// Thin wrapper around node:sqlite (built into Node >= 22.13; no native build step).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './schema.js';

function sanitize(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function sanitizeParams(params) {
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && !(params[0] instanceof Uint8Array)) {
    const out = {};
    for (const [k, v] of Object.entries(params[0])) out[k] = sanitize(v);
    return [out];
  }
  return params.map(sanitize);
}

export class Database {
  /** @param {string} file path or ':memory:' */
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA temp_store = MEMORY;');
    this.statements = new Map();
    this.depth = 0;
    this.migrate();
  }

  migrate() {
    const current = this.db.prepare('PRAGMA user_version').get().user_version;
    for (let v = current; v < MIGRATIONS.length; v += 1) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw new Error(`database migration ${v + 1} failed: ${err.message}`);
      }
    }
  }

  prepare(sql) {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  run(sql, ...params) { return this.prepare(sql).run(...sanitizeParams(params)); }
  get(sql, ...params) { return this.prepare(sql).get(...sanitizeParams(params)) ?? null; }
  all(sql, ...params) { return this.prepare(sql).all(...sanitizeParams(params)); }
  exec(sql) { this.db.exec(sql); }

  /** Run `fn` inside a transaction (nested calls use savepoints). */
  tx(fn) {
    const nested = this.depth > 0;
    const name = `sp${this.depth}`;
    this.db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
    this.depth += 1;
    try {
      const result = fn();
      this.depth -= 1;
      this.db.exec(nested ? `RELEASE ${name}` : 'COMMIT');
      return result;
    } catch (err) {
      this.depth -= 1;
      this.db.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK');
      throw err;
    }
  }

  // Simple key/value store for runtime metadata (gateway sessions, command hashes…).
  kvGet(key, fallback = null) {
    const row = this.get('SELECT value FROM kv WHERE key = ?', key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return fallback;
    }
  }

  kvSet(key, value) {
    this.run('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, JSON.stringify(value), Date.now());
  }

  kvDelete(key) {
    this.run('DELETE FROM kv WHERE key = ?', key);
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }
}
