// Discord HTTP API client: per-route rate-limit buckets (learned from X-RateLimit-Bucket),
// global limiter, automatic 429/5xx retries, multipart uploads and readable API errors.
import { setTimeout as sleep } from 'node:timers/promises';

const API_BASE = 'https://discord.com/api/v10';

export class DiscordAPIError extends Error {
  constructor({ status, body, method, path }) {
    const code = body && typeof body === 'object' ? body.code : undefined;
    const apiMessage = body && typeof body === 'object' && body.message ? body.message : `HTTP ${status}`;
    const details = body && typeof body === 'object' && body.errors ? flattenErrors(body.errors) : [];
    super(`${method} ${path} → ${status}${code !== undefined ? ` [${code}]` : ''} ${apiMessage}${details.length ? `\n    ${details.join('\n    ')}` : ''}`);
    this.name = 'DiscordAPIError';
    this.status = status;
    this.code = code;
    this.apiMessage = apiMessage;
    this.details = details;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

/** Turn Discord's nested `errors` object into `path: message` lines. */
export function flattenErrors(obj, prefix = '') {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj._errors)) {
    for (const e of obj._errors) out.push(`${prefix || '(body)'}: ${e.message}${e.code ? ` (${e.code})` : ''}`);
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === '_errors') continue;
    const next = /^\d+$/.test(key) ? `${prefix}[${key}]` : prefix ? `${prefix}.${key}` : key;
    out.push(...flattenErrors(value, next));
  }
  return out;
}

/** Compute the rate-limit identity of a request (route template + major parameter). */
export function routeInfo(method, path) {
  const clean = path.split('?')[0];
  if (clean.startsWith('/interactions/')) {
    const [, , id] = clean.split('/');
    return { routeId: `${method} /interactions/:id/:token/callback`, major: id, exempt: true };
  }
  let major = 'global';
  const m = clean.match(/^\/(channels|guilds|webhooks)\/(\d{16,20})(?:\/([^/]+))?/);
  if (m) major = m[1] === 'webhooks' && m[3] ? `${m[2]}/${m[3]}` : m[2];
  let template = clean
    .replace(/\/reactions\/.*$/, '/reactions/:emoji')
    .replace(/^\/webhooks\/\d{16,20}\/[^/]+/, '/webhooks/:major')
    .replace(/^\/(channels|guilds)\/\d{16,20}/, '/$1/:major')
    .replace(/\/\d{16,20}/g, '/:id');
  // Deleting messages has its own bucket in Discord's implementation.
  if (method === 'DELETE' && /\/channels\/:major\/messages\/:id$/.test(template)) template += ':delete';
  // Interaction webhooks (application id + token) are exempt from the global limit.
  const exempt = /^\/webhooks\/\d{16,20}\/[A-Za-z0-9_.-]{60,}/.test(clean);
  return { routeId: `${method} ${template}`, major, exempt };
}

class Bucket {
  constructor() {
    this.remaining = 1;
    this.resetAt = 0;
    this.tail = Promise.resolve();
  }
  enqueue(task) {
    const run = this.tail.then(task, task);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

class GlobalLimiter {
  constructor(perSecond = 45) {
    this.capacity = perSecond;
    this.tokens = perSecond;
    this.updated = Date.now();
    this.blockedUntil = 0;
  }
  async take() {
    for (;;) {
      const now = Date.now();
      if (this.blockedUntil > now) {
        await sleep(this.blockedUntil - now);
        continue;
      }
      const elapsed = (now - this.updated) / 1000;
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.capacity);
      this.updated = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(Math.ceil(((1 - this.tokens) / this.capacity) * 1000));
    }
  }
}

export class RestClient {
  /**
   * @param {{ token: string, userAgent: string, log: import('./logger.js').Logger, timeoutMs?: number }} options
   */
  constructor({ token, userAgent, log, timeoutMs = 15_000 }) {
    this.token = token;
    this.userAgent = userAgent;
    this.log = log;
    this.timeoutMs = timeoutMs;
    this.buckets = new Map();
    this.hashes = new Map();
    this.global = new GlobalLimiter();
    this.invalid = { windowStart: Date.now(), count: 0 };
    this.onUnauthorized = null;
  }

  get(path, options) { return this.request('GET', path, options); }
  post(path, body, options) { return this.request('POST', path, { ...options, body }); }
  patch(path, body, options) { return this.request('PATCH', path, { ...options, body }); }
  put(path, body, options) { return this.request('PUT', path, { ...options, body }); }
  delete(path, options) { return this.request('DELETE', path, options); }

  #bucketFor(routeId, major) {
    const hash = this.hashes.get(routeId);
    const key = `${hash ?? routeId}:${major}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new Bucket();
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  /**
   * @param {string} method
   * @param {string} path  e.g. `/channels/123/messages`
   * @param {{ body?: any, query?: Record<string, any>, files?: Array<{ name: string, data: Buffer|Uint8Array|string, contentType?: string }>, reason?: string, auth?: boolean }} [options]
   */
  request(method, path, options = {}) {
    const info = routeInfo(method, path);
    const bucket = this.#bucketFor(info.routeId, info.major);
    return bucket.enqueue(() => this.#execute(method, path, options, info, bucket, 0));
  }

  #recordInvalid(status, scope) {
    if (!(status === 401 || status === 403 || (status === 429 && scope !== 'shared'))) return;
    const now = Date.now();
    if (now - this.invalid.windowStart > 600_000) this.invalid = { windowStart: now, count: 0 };
    this.invalid.count += 1;
    if (this.invalid.count === 2_500 || this.invalid.count === 7_500) {
      this.log.warn(`High invalid request rate: ${this.invalid.count} in the current 10 minute window (limit 10,000).`);
    }
  }

  async #execute(method, path, options, info, bucket, attempt) {
    const now = Date.now();
    if (bucket.remaining <= 0 && bucket.resetAt > now) await sleep(bucket.resetAt - now + 25);
    if (!info.exempt) await this.global.take();

    let url = `${API_BASE}${path}`;
    if (options.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(options.query)) if (v !== undefined && v !== null) params.set(k, String(v));
      const qs = params.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }

    const headers = { 'User-Agent': this.userAgent };
    if (options.auth !== false) headers.Authorization = `Bot ${this.token}`;
    if (options.reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(options.reason).slice(0, 512);

    let body;
    if (options.files?.length) {
      const form = new FormData();
      const payload = { ...(options.body || {}) };
      payload.attachments = [...(payload.attachments || []), ...options.files.map((f, i) => ({ id: i, filename: f.name }))];
      form.set('payload_json', JSON.stringify(payload));
      options.files.forEach((f, i) => form.set(`files[${i}]`, new Blob([f.data], { type: f.contentType || 'application/octet-stream' }), f.name));
      body = form;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let res;
    try {
      res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      const retryable = method !== 'POST' && attempt < 3;
      this.log.warn(`${method} ${path} network error (${err.name}: ${err.message})${retryable ? ' — retrying' : ''}`);
      if (retryable) {
        await sleep(500 * 2 ** attempt);
        return this.#execute(method, path, options, info, bucket, attempt + 1);
      }
      throw err;
    }

    const hash = res.headers.get('x-ratelimit-bucket');
    if (hash && this.hashes.get(info.routeId) !== hash) {
      this.hashes.set(info.routeId, hash);
      const key = `${hash}:${info.major}`;
      if (!this.buckets.has(key)) this.buckets.set(key, bucket);
    }
    const remaining = res.headers.get('x-ratelimit-remaining');
    const resetAfter = res.headers.get('x-ratelimit-reset-after');
    if (remaining !== null) bucket.remaining = Number(remaining);
    if (resetAfter !== null) bucket.resetAt = Date.now() + Number(resetAfter) * 1000;

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const scope = res.headers.get('x-ratelimit-scope') || (data.global ? 'global' : 'user');
      const retryMs = Math.ceil(Number(data.retry_after ?? res.headers.get('retry-after') ?? 1) * 1000);
      this.#recordInvalid(429, scope);
      if (data.global || scope === 'global') this.global.blockedUntil = Date.now() + retryMs;
      else {
        bucket.remaining = 0;
        bucket.resetAt = Date.now() + retryMs;
      }
      this.log.warn(`429 on ${method} ${info.routeId} (scope ${scope}); retrying in ${retryMs}ms`);
      if (attempt < 4) return this.#execute(method, path, options, info, bucket, attempt + 1);
      throw new DiscordAPIError({ status: 429, body: data, method, path });
    }

    if (res.status >= 500 && attempt < 3) {
      this.log.warn(`${method} ${path} → ${res.status}; retrying`);
      await sleep(750 * 2 ** attempt);
      return this.#execute(method, path, options, info, bucket, attempt + 1);
    }

    const contentType = res.headers.get('content-type') || '';
    const data = res.status === 204 ? null : contentType.includes('application/json') ? await res.json().catch(() => null) : await res.arrayBuffer();

    if (!res.ok) {
      this.#recordInvalid(res.status);
      if (res.status === 401 && this.onUnauthorized) this.onUnauthorized();
      throw new DiscordAPIError({ status: res.status, body: data, method, path });
    }
    return data;
  }
}
