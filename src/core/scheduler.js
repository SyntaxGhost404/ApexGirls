// Persistent job scheduler (SQLite-backed, at-least-once) plus guarded in-memory intervals.
// Job handlers must be idempotent: a job is removed only after its handler finished.

export class Scheduler {
  constructor({ db, log }) {
    this.db = db;
    this.log = log;
    this.handlers = new Map();
    this.timer = null;
    this.intervals = [];
    this.running = false;
    this.ticking = false;
  }

  register(kind, handler) {
    this.handlers.set(kind, handler);
  }

  /** Create or replace a job. */
  schedule(id, kind, runAt, payload = {}) {
    this.db.run(
      `INSERT INTO jobs (id, kind, run_at, payload, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, run_at = excluded.run_at, payload = excluded.payload, attempts = 0`,
      id, kind, Math.floor(runAt), JSON.stringify(payload), Date.now(),
    );
    this.#arm();
  }

  cancel(id) {
    this.db.run('DELETE FROM jobs WHERE id = ?', id);
  }

  get(id) {
    const row = this.db.get('SELECT * FROM jobs WHERE id = ?', id);
    return row ? { ...row, payload: JSON.parse(row.payload) } : null;
  }

  start() {
    this.running = true;
    this.#arm();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    for (const i of this.intervals) clearInterval(i);
    this.intervals = [];
  }

  /** Run `fn` every `ms` milliseconds, swallowing (but logging) errors. */
  every(name, ms, fn) {
    const handle = setInterval(async () => {
      try {
        await fn();
      } catch (err) {
        this.log.error(`interval ${name} failed`, err);
      }
    }, ms);
    handle.unref?.();
    this.intervals.push(handle);
    return handle;
  }

  #arm() {
    if (!this.running) return;
    clearTimeout(this.timer);
    const next = this.db.get('SELECT MIN(run_at) AS at FROM jobs')?.at;
    if (next === null || next === undefined) return;
    const delay = Math.min(Math.max(0, next - Date.now()), 60_000);
    this.timer = setTimeout(() => this.#tick(), delay);
    this.timer.unref?.();
  }

  async #tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = this.db.all('SELECT * FROM jobs WHERE run_at <= ? ORDER BY run_at LIMIT 25', Date.now());
      for (const job of due) {
        const handler = this.handlers.get(job.kind);
        if (!handler) {
          this.log.warn(`no handler for job kind ${job.kind}; dropping ${job.id}`);
          this.db.run('DELETE FROM jobs WHERE id = ?', job.id);
          continue;
        }
        try {
          await handler(JSON.parse(job.payload), job);
          // Only delete if the handler didn't reschedule the same id.
          this.db.run('DELETE FROM jobs WHERE id = ? AND run_at = ?', job.id, job.run_at);
        } catch (err) {
          const attempts = job.attempts + 1;
          this.log.error(`job ${job.id} (${job.kind}) failed (attempt ${attempts})`, err);
          if (attempts >= 5) this.db.run('DELETE FROM jobs WHERE id = ?', job.id);
          else this.db.run('UPDATE jobs SET attempts = ?, run_at = ? WHERE id = ? AND run_at = ?', attempts, Date.now() + 30_000 * attempts, job.id, job.run_at);
        }
      }
    } finally {
      this.ticking = false;
      this.#arm();
    }
  }
}
