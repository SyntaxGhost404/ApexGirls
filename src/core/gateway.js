// Discord Gateway client (API v10, JSON encoding, optional zlib-stream transport compression).
// Implements heartbeating with zombie detection, identify throttling with a session-start budget
// guard, resuming (including across process restarts), backoff reconnects and send rate limiting.
import { EventEmitter } from 'node:events';
import os from 'node:os';
import zlib from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

export const Intents = {
  Guilds: 1 << 0,
  GuildMembers: 1 << 1,
  GuildModeration: 1 << 2,
  GuildExpressions: 1 << 3,
  GuildIntegrations: 1 << 4,
  GuildWebhooks: 1 << 5,
  GuildInvites: 1 << 6,
  GuildVoiceStates: 1 << 7,
  GuildPresences: 1 << 8,
  GuildMessages: 1 << 9,
  GuildMessageReactions: 1 << 10,
  GuildMessageTyping: 1 << 11,
  DirectMessages: 1 << 12,
  DirectMessageReactions: 1 << 13,
  DirectMessageTyping: 1 << 14,
  MessageContent: 1 << 15,
  GuildScheduledEvents: 1 << 16,
  AutoModerationConfiguration: 1 << 20,
  AutoModerationExecution: 1 << 21,
  GuildMessagePolls: 1 << 24,
  DirectMessagePolls: 1 << 25,
};
export const PRIVILEGED_INTENTS = Intents.GuildMembers | Intents.GuildPresences | Intents.MessageContent;

export const Op = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  PresenceUpdate: 3,
  VoiceStateUpdate: 4,
  Resume: 6,
  Reconnect: 7,
  RequestGuildMembers: 8,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
};

const FATAL_CLOSE_CODES = new Map([
  [4004, 'Authentication failed — the bot token is invalid or was reset.'],
  [4010, 'Invalid shard configuration.'],
  [4011, 'Sharding is required for this many guilds.'],
  [4012, 'Invalid gateway API version.'],
  [4013, 'Invalid intents bitfield.'],
  [4014, 'Disallowed intents — enable the privileged intents in the Developer Portal (Bot → Privileged Gateway Intents).'],
]);
/** Close codes after which the session cannot be resumed (reconnect with a fresh identify). */
const NEW_SESSION_CLOSE_CODES = new Set([4003, 4007, 4009]);
const RESUME_WINDOW_MS = 150_000;
const ZLIB_SUFFIX = Buffer.from([0x00, 0x00, 0xff, 0xff]);

/** Shared-context zlib-stream decompressor for one gateway connection. */
export class ZlibStreamDecoder {
  constructor() {
    this.inflate = zlib.createInflate({ flush: zlib.constants.Z_SYNC_FLUSH, chunkSize: 64 * 1024 });
    this.chunks = [];
    this.error = null;
    this.inflate.on('data', (chunk) => this.chunks.push(chunk));
    this.inflate.on('error', (err) => { this.error = err; });
  }
  /** Feed one websocket frame. Resolves to the decoded text when the frame completes a payload, else null. */
  push(frame) {
    const buffer = Buffer.isBuffer(frame) ? frame : Buffer.concat(Array.isArray(frame) ? frame : [Buffer.from(frame)]);
    return new Promise((resolve, reject) => {
      this.inflate.write(buffer, (err) => {
        if (err || this.error) return reject(err || this.error);
        const complete = buffer.length >= 4 && buffer.subarray(buffer.length - 4).equals(ZLIB_SUFFIX);
        if (!complete) return resolve(null);
        const out = Buffer.concat(this.chunks);
        this.chunks = [];
        resolve(out.toString('utf8'));
      });
    });
  }
  destroy() {
    this.inflate.removeAllListeners('data');
    this.inflate.on('error', () => {});
    this.inflate.destroy();
  }
}

/** Sliding-window limiter for gateway sends (120 per 60s; we keep headroom for heartbeats). */
class SendLimiter {
  constructor(limit = 110, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.sent = [];
  }
  async wait() {
    for (;;) {
      const now = Date.now();
      while (this.sent.length && now - this.sent[0] > this.windowMs) this.sent.shift();
      if (this.sent.length < this.limit) {
        this.sent.push(now);
        return;
      }
      await sleep(this.windowMs - (now - this.sent[0]) + 10);
    }
  }
}

class Shard {
  constructor(manager, id) {
    this.manager = manager;
    this.id = id;
    this.log = manager.log.child(`shard:${id}`);
    this.ws = null;
    this.decoder = null;
    this.chain = Promise.resolve();
    this.sessionId = null;
    this.resumeUrl = null;
    this.seq = null;
    this.status = 'idle';
    this.heartbeatTimer = null;
    this.helloTimer = null;
    this.reconnectTimer = null;
    this.lastAck = true;
    this.lastHeartbeatAt = 0;
    this.latency = -1;
    this.attempts = 0;
    this.destroyed = false;
    this.limiter = new SendLimiter();
    this.readyAt = 0;
  }

  restoreSession(saved) {
    if (!saved || Date.now() - saved.savedAt > RESUME_WINDOW_MS) return false;
    this.sessionId = saved.sessionId;
    this.resumeUrl = saved.resumeUrl;
    this.seq = saved.seq;
    return true;
  }

  get canResume() {
    return Boolean(this.sessionId && this.resumeUrl && this.seq !== null);
  }

  resetSession() {
    this.sessionId = null;
    this.resumeUrl = null;
    this.seq = null;
  }

  connect() {
    if (this.destroyed) return;
    clearTimeout(this.reconnectTimer);
    const base = this.canResume ? this.resumeUrl : this.manager.gatewayUrl;
    const url = new URL(base);
    url.searchParams.set('v', '10');
    url.searchParams.set('encoding', 'json');
    if (this.manager.compress) url.searchParams.set('compress', 'zlib-stream');

    this.decoder?.destroy();
    this.decoder = this.manager.compress ? new ZlibStreamDecoder() : null;
    this.chain = Promise.resolve();
    this.status = 'connecting';
    this.log.debug(`connecting to ${url.host} (${this.canResume ? 'resume' : 'identify'})`);

    const ws = new WebSocket(url.toString(), { agent: this.manager.agent, handshakeTimeout: 30_000, perMessageDeflate: false });
    this.ws = ws;
    this.helloTimer = setTimeout(() => {
      if (this.ws === ws && this.status === 'connecting') {
        this.log.warn('no HELLO within 20s — reconnecting');
        ws.terminate();
      }
    }, 20_000);

    ws.on('message', (data, isBinary) => {
      if (this.ws !== ws) return;
      if (this.decoder && isBinary) {
        this.chain = this.chain
          .then(() => this.decoder.push(data))
          .then((text) => text && this.#onText(text))
          .catch((err) => {
            this.log.error('zlib-stream decode failure', err);
            ws.terminate();
          });
      } else {
        this.#onText(data.toString());
      }
    });
    ws.on('close', (code, reason) => {
      if (this.ws !== ws) return;
      this.#onClose(code, reason?.toString() || '');
    });
    ws.on('error', (err) => this.log.warn(`socket error: ${err.message}`));
    ws.on('unexpected-response', (_req, res) => {
      this.log.warn(`gateway handshake rejected with HTTP ${res.statusCode}`);
      ws.terminate();
    });
  }

  #onText(text) {
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      this.log.warn('unparseable gateway payload', err);
      return;
    }
    this.#onPayload(payload);
  }

  #onPayload({ op, d, s, t }) {
    if (s !== null && s !== undefined) this.seq = s;
    switch (op) {
      case Op.Hello:
        clearTimeout(this.helloTimer);
        this.#startHeartbeat(d.heartbeat_interval);
        if (this.canResume) this.#resume();
        else this.#identify();
        break;
      case Op.HeartbeatAck:
        this.lastAck = true;
        this.latency = Date.now() - this.lastHeartbeatAt;
        break;
      case Op.Heartbeat:
        this.#heartbeat(true);
        break;
      case Op.Reconnect:
        this.log.info('gateway requested reconnect');
        this.#reconnect(4900);
        break;
      case Op.InvalidSession:
        this.log.warn(`invalid session (resumable: ${Boolean(d)})`);
        if (!d) this.resetSession();
        this.#reconnect(4901, 1000 + Math.random() * 4000);
        break;
      case Op.Dispatch:
        this.#onDispatch(t, d);
        break;
      default:
        break;
    }
  }

  #onDispatch(t, d) {
    if (t === 'READY') {
      this.sessionId = d.session_id;
      this.resumeUrl = d.resume_gateway_url;
      this.status = 'ready';
      this.attempts = 0;
      this.readyAt = Date.now();
      this.log.info(`READY as ${d.user?.username} (${d.guilds?.length ?? 0} guilds, session ${d.session_id.slice(0, 8)}…)`);
    } else if (t === 'RESUMED') {
      this.status = 'ready';
      this.attempts = 0;
      this.log.info(`RESUMED session at seq ${this.seq}`);
    }
    this.manager.emit('dispatch', t, d, this.id);
  }

  #startHeartbeat(interval) {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.heartbeatTimer);
    this.lastAck = true;
    this.heartbeatTimer = setTimeout(() => {
      this.#heartbeat();
      this.heartbeatTimer = setInterval(() => this.#heartbeat(), interval);
    }, Math.floor(interval * Math.random()));
  }

  #heartbeat(requested = false) {
    if (!requested && !this.lastAck) {
      this.log.warn('heartbeat not acknowledged — zombied connection, reconnecting');
      this.#reconnect(4902);
      return;
    }
    this.lastAck = false;
    this.lastHeartbeatAt = Date.now();
    this.#sendRaw({ op: Op.Heartbeat, d: this.seq });
  }

  async #identify() {
    await this.manager.identifyGate(this.id);
    if (this.destroyed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.status = 'identifying';
    this.#sendRaw({
      op: Op.Identify,
      d: {
        token: this.manager.token,
        intents: this.manager.intents,
        properties: { os: os.platform(), browser: 'sanctuary-core', device: 'sanctuary-core' },
        compress: false,
        large_threshold: 50,
        shard: [this.id, this.manager.totalShards],
        presence: this.manager.presence,
      },
    });
  }

  #resume() {
    this.status = 'resuming';
    this.#sendRaw({ op: Op.Resume, d: { token: this.manager.token, session_id: this.sessionId, seq: this.seq } });
  }

  #sendRaw(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  async send(payload) {
    await this.limiter.wait();
    this.#sendRaw(payload);
  }

  #cleanup() {
    clearTimeout(this.helloTimer);
    clearTimeout(this.heartbeatTimer);
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  #reconnect(code = 4900, delay = 0) {
    this.#cleanup();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(code);
      } catch {
        ws.terminate();
      }
      setTimeout(() => ws.readyState !== WebSocket.CLOSED && ws.terminate(), 5_000).unref();
    }
    this.status = 'reconnecting';
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  #onClose(code, reason) {
    this.#cleanup();
    this.ws = null;
    if (this.destroyed) return;
    if (FATAL_CLOSE_CODES.has(code)) {
      this.status = 'dead';
      this.log.error(`gateway closed with fatal code ${code}: ${FATAL_CLOSE_CODES.get(code)}`);
      this.manager.emit('fatal', { shardId: this.id, code, message: FATAL_CLOSE_CODES.get(code) });
      return;
    }
    if (NEW_SESSION_CLOSE_CODES.has(code)) this.resetSession();
    const delay = Math.min(60_000, 1_000 * 2 ** this.attempts) * (0.5 + Math.random() / 2);
    this.attempts += 1;
    this.status = 'reconnecting';
    this.log.warn(`gateway closed (${code}${reason ? ` ${reason}` : ''}); reconnecting in ${Math.round(delay)}ms`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /** Close the connection. With `resumable`, Discord keeps the session alive for a quick resume. */
  destroy({ resumable = false } = {}) {
    this.destroyed = true;
    this.#cleanup();
    clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(resumable ? 4999 : 1000);
      } catch {
        ws.terminate();
      }
    }
    this.decoder?.destroy();
    this.status = 'destroyed';
  }
}

export class GatewayManager extends EventEmitter {
  /**
   * @param {{ rest: import('./rest.js').RestClient, token: string, intents: number, compress?: boolean,
   *   log: import('./logger.js').Logger, presence?: object, agent?: any, sessionStore?: { load(id:number): any, save(id:number, data:any): void, clear(id:number): void } }} options
   */
  constructor({ rest, token, intents, compress = true, log, presence, agent, sessionStore }) {
    super();
    this.rest = rest;
    this.token = token;
    this.intents = intents;
    this.compress = compress;
    this.log = log;
    this.presence = presence;
    this.agent = agent;
    this.sessionStore = sessionStore;
    this.shards = new Map();
    this.gatewayUrl = 'wss://gateway.discord.gg';
    this.totalShards = 1;
    this.maxConcurrency = 1;
    this.sessionLimit = null;
    this.identifyTimes = new Map();
    this.identifyLock = Promise.resolve();
  }

  async start() {
    const info = await this.rest.get('/gateway/bot');
    this.gatewayUrl = info.url;
    this.totalShards = Math.max(1, info.shards || 1);
    this.maxConcurrency = info.session_start_limit?.max_concurrency || 1;
    this.sessionLimit = { ...info.session_start_limit, fetchedAt: Date.now() };
    this.log.info(`gateway: ${this.totalShards} shard(s), ${info.session_start_limit.remaining}/${info.session_start_limit.total} session starts remaining`);

    let resumed = false;
    for (let id = 0; id < this.totalShards; id += 1) {
      const shard = new Shard(this, id);
      if (this.sessionStore && shard.restoreSession(this.sessionStore.load(id))) {
        resumed = true;
        this.log.info(`shard ${id}: attempting to resume previous session`);
      }
      this.sessionStore?.clear(id);
      this.shards.set(id, shard);
      shard.connect();
    }
    return { resumed };
  }

  /** Serialises identifies per rate-limit key and protects the daily session-start budget. */
  identifyGate(shardId) {
    const run = this.identifyLock.then(async () => {
      const limit = this.sessionLimit;
      if (limit) {
        if (limit.remaining <= 3) {
          const waitMs = Math.max(0, limit.reset_after - (Date.now() - limit.fetchedAt));
          this.log.error(`Session start budget nearly exhausted (${limit.remaining} left). Waiting ${Math.round(waitMs / 60000)} min before identifying to protect the token.`);
          await sleep(waitMs + 1_000);
          const fresh = await this.rest.get('/gateway/bot').catch(() => null);
          if (fresh) this.sessionLimit = { ...fresh.session_start_limit, fetchedAt: Date.now() };
        }
        this.sessionLimit.remaining -= 1;
      }
      const key = shardId % this.maxConcurrency;
      const last = this.identifyTimes.get(key) || 0;
      const wait = last + 5_500 - Date.now();
      if (wait > 0) await sleep(wait);
      this.identifyTimes.set(key, Date.now());
    });
    this.identifyLock = run.catch(() => undefined);
    return run;
  }

  get ping() {
    const values = [...this.shards.values()].map((s) => s.latency).filter((v) => v >= 0);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : -1;
  }

  get ready() {
    return [...this.shards.values()].every((s) => s.status === 'ready');
  }

  status() {
    return [...this.shards.values()].map((s) => ({ id: s.id, status: s.status, latency: s.latency, seq: s.seq }));
  }

  shardFor(guildId) {
    if (!guildId) return this.shards.get(0);
    return this.shards.get(Number((BigInt(guildId) >> 22n) % BigInt(this.totalShards)));
  }

  updatePresence(presence) {
    this.presence = presence;
    for (const shard of this.shards.values()) shard.send({ op: Op.PresenceUpdate, d: presence });
  }

  /** Stop all shards. With `resumable`, sessions are persisted so the next start can RESUME. */
  stop({ resumable = false } = {}) {
    for (const shard of this.shards.values()) {
      if (resumable && shard.canResume && shard.status === 'ready' && this.sessionStore) {
        this.sessionStore.save(shard.id, { sessionId: shard.sessionId, resumeUrl: shard.resumeUrl, seq: shard.seq, savedAt: Date.now() });
      }
      shard.destroy({ resumable });
    }
  }
}
