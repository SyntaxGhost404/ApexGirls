// Composition root: wires REST, gateway, cache, router, database, scheduler and services together.
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { RestClient } from './core/rest.js';
import { GatewayManager, Intents, PRIVILEGED_INTENTS } from './core/gateway.js';
import { Cache } from './core/cache.js';
import { InteractionRouter } from './core/interactions.js';
import { Scheduler } from './core/scheduler.js';
import { createApi } from './core/api.js';
import { startHttpServer } from './core/http.js';
import { Database } from './db/database.js';
import { SettingsService, GuildStateService } from './services/settings.js';
import { MemberService } from './services/members.js';
import { Economy } from './services/economy.js';
import { EmojiRegistry } from './services/emojis.js';
import { errorNotice } from './ui.js';

const PRESENCE = {
  since: null,
  status: 'online',
  afk: false,
  activities: [{ name: 'Sanctuary Core', type: 4, state: '🛰️ Guarding the Sanctuary · /help' }],
};

export class Bot {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.applicationId = config.applicationId;
    this.rest = new RestClient({ token: config.token, userAgent: config.userAgent, log: log.child('rest') });
    this.cache = new Cache();
    this.db = new Database(config.databasePath);
    this.scheduler = new Scheduler({ db: this.db, log: log.child('scheduler') });
    this.router = new InteractionRouter(this);
    this.router.renderError = (err) => errorNotice(err);
    this.bus = new EventEmitter();
    this.bus.setMaxListeners(100);
    this.settings = new SettingsService(this);
    this.state = new GuildStateService(this);
    this.members = new MemberService(this);
    this.economy = new Economy(this);
    this.emojis = new EmojiRegistry(this);
    this.api = createApi(this);
    this.services = {};
    this.handlers = new Map();
    this.gateway = null;
    this.http = null;
    this.contentIntent = false;
    this.membersIntent = false;
    this.stopping = false;
    this.degradedIntents = false;
  }

  /** Subscribe to a gateway dispatch (e.g. 'MESSAGE_CREATE') with error isolation. */
  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
  }

  #emit(event, data, shardId) {
    for (const handler of this.handlers.get(event) || []) {
      try {
        const result = handler(data, shardId);
        if (result && typeof result.catch === 'function') result.catch((err) => this.log.error(`${event} handler failed`, err));
      } catch (err) {
        this.log.error(`${event} handler failed`, err);
      }
    }
  }

  /** Publish an internal activity event (quests, factions and achievements listen to these). */
  activity(event) {
    for (const fn of this.bus.listeners('activity')) {
      try {
        const r = fn(event);
        if (r && typeof r.catch === 'function') r.catch((err) => this.log.error('activity listener failed', err));
      } catch (err) {
        this.log.error('activity listener failed', err);
      }
    }
  }

  onActivity(fn) {
    this.bus.on('activity', fn);
  }

  intents({ privileged = true } = {}) {
    let intents = Intents.Guilds | Intents.GuildMessages | Intents.GuildVoiceStates | Intents.GuildMessageReactions;
    if (privileged && this.config.intents.messageContent) intents |= Intents.MessageContent;
    if (privileged && this.config.intents.guildMembers) intents |= Intents.GuildMembers;
    return intents;
  }

  async #proxyAgent() {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    if (!proxy) return undefined;
    const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map((s) => s.trim());
    if (noProxy.some((h) => h && 'gateway.discord.gg'.endsWith(h.replace(/^\*/, '')))) return undefined;
    try {
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      this.log.info('using HTTPS proxy for the gateway connection');
      return new HttpsProxyAgent(proxy);
    } catch {
      this.log.warn('HTTPS_PROXY is set but https-proxy-agent is not installed; connecting directly');
      return undefined;
    }
  }

  async syncCommands({ force = false } = {}) {
    const defs = this.router.definitions();
    const { commandScope: scope, devGuildId } = this.config;
    const hash = createHash('sha256').update(JSON.stringify({ scope, devGuildId, defs, app: this.applicationId })).digest('hex');
    if (!force && this.db.kvGet('commands.hash') === hash) {
      this.log.info(`application commands up to date (${defs.length})`);
      return { changed: false, count: defs.length };
    }
    const path = scope === 'guild' ? `/applications/${this.applicationId}/guilds/${devGuildId}/commands` : `/applications/${this.applicationId}/commands`;
    const result = await this.rest.put(path, defs);
    // Avoid duplicate commands when moving from guild-scoped development to global.
    const previousGuild = this.db.kvGet('commands.guildScope');
    if (scope === 'global' && previousGuild) {
      await this.rest.put(`/applications/${this.applicationId}/guilds/${previousGuild}/commands`, []).catch(() => null);
      this.db.kvDelete('commands.guildScope');
    }
    if (scope === 'guild') this.db.kvSet('commands.guildScope', devGuildId);
    this.db.kvSet('commands.hash', hash);
    this.log.info(`synced ${result.length} ${scope} application commands`);
    return { changed: true, count: result.length };
  }

  async start() {
    const me = await this.rest.get('/users/@me');
    this.cache.user = me;
    this.applicationId = this.applicationId || me.id;
    this.cache.applicationId = this.applicationId;
    this.log.info(`authenticated as ${me.username} (${me.id})`);

    await this.emojis.load();
    if (this.config.syncCommands) await this.syncCommands().catch((err) => this.log.error('command sync failed', err));
    this.scheduler.start();
    await this.#startGateway(this.intents());
    if (this.config.http.port) this.http = startHttpServer(this, this.config.http);
  }

  async #startGateway(intents) {
    this.contentIntent = Boolean(intents & Intents.MessageContent);
    this.membersIntent = Boolean(intents & Intents.GuildMembers);
    const sessionStore = {
      load: (id) => this.db.kvGet(`gateway.session.${id}`),
      save: (id, data) => this.db.kvSet(`gateway.session.${id}`, data),
      clear: (id) => this.db.kvDelete(`gateway.session.${id}`),
    };
    // Resuming across a restart replays missed events but no GUILD_CREATEs, so restore the snapshot.
    const saved = sessionStore.load(0);
    if (saved && Date.now() - saved.savedAt < 150_000) this.cache.load(this.db.kvGet('cache.snapshot'));
    this.db.kvDelete('cache.snapshot');

    this.gateway = new GatewayManager({
      rest: this.rest,
      token: this.config.token,
      intents,
      compress: this.config.gatewayCompression,
      log: this.log.child('gateway'),
      presence: PRESENCE,
      agent: await this.#proxyAgent(),
      sessionStore,
    });
    this.gateway.on('dispatch', (t, d, shardId) => this.#onDispatch(t, d, shardId));
    this.gateway.on('fatal', ({ code, message }) => this.#onFatal(code, message));
    await this.gateway.start();
  }

  #onDispatch(t, d, shardId) {
    try {
      this.cache.handle(t, d);
    } catch (err) {
      this.log.error(`cache update failed for ${t}`, err);
    }
    if (t === 'INTERACTION_CREATE') {
      this.router.dispatch(d).catch((err) => this.log.error('interaction dispatch failed', err));
      return;
    }
    if (t === 'READY' && d.application?.id) this.applicationId = d.application.id;
    this.#emit(t, d, shardId);
  }

  async #onFatal(code, message) {
    if (code === 4014 && !this.degradedIntents && (this.intents() & PRIVILEGED_INTENTS)) {
      this.degradedIntents = true;
      this.log.error(`${message} Continuing WITHOUT privileged intents: anti-spam text checks and welcome cards are disabled until you enable them.`);
      this.gateway.stop();
      await this.#startGateway(this.intents({ privileged: false })).catch((err) => this.log.error('gateway restart failed', err));
      return;
    }
    this.log.error(`Gateway cannot continue: ${message}`);
    await this.stop({ resumable: false });
    process.exit(1);
  }

  async stop({ resumable = true } = {}) {
    if (this.stopping) return;
    this.stopping = true;
    this.scheduler.stop();
    if (this.gateway) {
      this.gateway.stop({ resumable });
      if (resumable) this.db.kvSet('cache.snapshot', this.cache.toJSON());
    }
    if (this.http) await new Promise((r) => this.http.close(r));
    this.db.close();
  }
}
