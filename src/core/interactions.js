// Interaction context + router. Works for interactions received over the gateway or over HTTP.
// The context tracks acknowledgement state so handlers can call reply()/update() without caring
// whether the safety-net auto-defer already fired.
import { MessageFlags, validateMessage, validateModal } from './components.js';
import { DiscordAPIError } from './rest.js';
import { has, P, toBig } from './permissions.js';

export const InteractionType = { Ping: 1, ApplicationCommand: 2, MessageComponent: 3, Autocomplete: 4, ModalSubmit: 5 };
export const CallbackType = { Pong: 1, ChannelMessage: 4, DeferredChannelMessage: 5, DeferredUpdate: 6, UpdateMessage: 7, AutocompleteResult: 8, Modal: 9 };
export const CommandType = { ChatInput: 1, User: 2, Message: 3 };
export const OptionType = { Subcommand: 1, SubcommandGroup: 2, String: 3, Integer: 4, Boolean: 5, User: 6, Channel: 7, Role: 8, Mentionable: 9, Number: 10, Attachment: 11 };

/** An error whose message is safe and helpful to show to the user. */
export class UserError extends Error {
  constructor(message, { title = 'Request denied', tone = 'danger' } = {}) {
    super(message);
    this.name = 'UserError';
    this.title = title;
    this.tone = tone;
  }
}

function normalize(payload, { forEdit = false } = {}) {
  const out = { ...payload };
  let flags = out.flags || 0;
  if (out.ephemeral) flags |= MessageFlags.Ephemeral;
  delete out.ephemeral;
  if (forEdit) flags &= ~MessageFlags.Ephemeral;
  if (flags) out.flags = flags;
  if (flags & MessageFlags.IsComponentsV2) {
    delete out.content;
    delete out.embeds;
  }
  if (!out.allowed_mentions) out.allowed_mentions = { parse: [] };
  const files = out.files;
  delete out.files;
  return { body: out, files };
}

export class InteractionContext {
  constructor(bot, raw) {
    this.bot = bot;
    this.raw = raw;
    this.state = 'new';
    this.ackPromise = null;
    this.firstAck = new Promise((resolve) => { this.resolveFirstAck = resolve; });
    this.#parseOptions();
  }

  get id() { return this.raw.id; }
  get token() { return this.raw.token; }
  get type() { return this.raw.type; }
  get data() { return this.raw.data || {}; }
  get guildId() { return this.raw.guild_id || null; }
  get channelId() { return this.raw.channel_id || this.raw.channel?.id || null; }
  get user() { return this.raw.member?.user || this.raw.user; }
  get userId() { return this.user?.id; }
  get member() { return this.raw.member || null; }
  get memberRoles() { return this.raw.member?.roles || []; }
  get memberPermissions() { return toBig(this.raw.member?.permissions); }
  get appPermissions() { return toBig(this.raw.app_permissions); }
  get locale() { return this.raw.locale; }
  get message() { return this.raw.message || null; }
  get customId() { return this.data.custom_id || ''; }
  get commandName() { return this.data.name; }
  get values() { return this.data.values || []; }
  get resolved() { return this.data.resolved || {}; }
  get acknowledged() { return this.state !== 'new'; }
  get isCommand() { return this.type === InteractionType.ApplicationCommand; }
  get isComponent() { return this.type === InteractionType.MessageComponent; }
  get isModal() { return this.type === InteractionType.ModalSubmit; }

  /** True for Manage Server / Administrator members. */
  get isManager() {
    return has(this.memberPermissions, P.MANAGE_GUILD);
  }

  #parseOptions() {
    let opts = this.data.options || [];
    this.subcommandGroup = null;
    this.subcommand = null;
    if (opts[0]?.type === OptionType.SubcommandGroup) {
      this.subcommandGroup = opts[0].name;
      opts = opts[0].options || [];
    }
    if (opts[0]?.type === OptionType.Subcommand) {
      this.subcommand = opts[0].name;
      opts = opts[0].options || [];
    }
    this.options = opts;
  }

  option(name, fallback = null) {
    const o = this.options.find((x) => x.name === name);
    return o === undefined || o.value === undefined ? fallback : o.value;
  }

  get focused() {
    return this.options.find((o) => o.focused) || null;
  }

  optionUser(name) {
    const id = this.option(name);
    if (!id) return null;
    return { id, user: this.resolved.users?.[id] || null, member: this.resolved.members?.[id] || null };
  }

  /** Map of modal custom_id → submitted component (Label/ActionRow nesting is flattened). */
  get fields() {
    if (this._fields) return this._fields;
    const map = new Map();
    const visit = (c) => {
      if (!c) return;
      if (c.custom_id !== undefined) map.set(c.custom_id, c);
      if (c.component) visit(c.component);
      if (Array.isArray(c.components)) c.components.forEach(visit);
    };
    (this.data.components || []).forEach(visit);
    this._fields = map;
    return map;
  }

  /** Value of a modal field: string (text/radio), string[] (selects/checkbox groups), boolean (checkbox). */
  field(id, fallback = null) {
    const c = this.fields.get(id);
    if (!c) return fallback;
    if (c.values !== undefined) return c.values;
    if (c.value !== undefined && c.value !== null) return c.value;
    return fallback;
  }

  // ── responses ────────────────────────────────────────────────────────────
  async #callback(type, data, files) {
    if (this.bot.config?.debugValidate && data && (type === CallbackType.ChannelMessage || type === CallbackType.UpdateMessage)) {
      const problems = validateMessage(data);
      if (problems.length) this.bot.log.warn(`payload problems for ${this.customId || this.commandName}:\n  ${problems.join('\n  ')}`);
    }
    try {
      await this.bot.rest.request('POST', `/interactions/${this.id}/${this.token}/callback`, { body: { type, ...(data ? { data } : {}) }, files });
    } finally {
      this.resolveFirstAck();
    }
  }

  async #awaitPendingAck() {
    if (this.ackPromise) await this.ackPromise.catch(() => undefined);
  }

  /** Send the initial response (or edit the deferred placeholder). */
  async reply(payload) {
    await this.#awaitPendingAck();
    // A deferred command response is a placeholder we can fill; after a deferred *update*
    // (component) the original message is the panel itself, so a reply must be a new followup.
    if (this.state === 'deferred') return this.editReply(payload);
    if (this.state !== 'new') return this.followUp(payload);
    const { body, files } = normalize(payload);
    this.state = 'replied';
    this.ackPromise = this.#callback(CallbackType.ChannelMessage, body, files);
    return this.ackPromise;
  }

  /** Update the message a component is attached to. */
  async update(payload) {
    await this.#awaitPendingAck();
    if (this.state === 'deferred-update' || this.state === 'updated') return this.editReply(payload);
    if (this.state === 'deferred' || this.state === 'replied') return this.editReply(payload);
    if (!(this.isComponent || (this.isModal && this.message))) return this.reply(payload);
    const { body, files } = normalize(payload, { forEdit: true });
    this.state = 'updated';
    this.ackPromise = this.#callback(CallbackType.UpdateMessage, body, files);
    return this.ackPromise;
  }

  async defer({ ephemeral = true } = {}) {
    if (this.state !== 'new') return this.ackPromise;
    this.state = 'deferred';
    this.ackPromise = this.#callback(CallbackType.DeferredChannelMessage, ephemeral ? { flags: MessageFlags.Ephemeral } : undefined);
    return this.ackPromise;
  }

  async deferUpdate() {
    if (this.state !== 'new') return this.ackPromise;
    if (!(this.isComponent || (this.isModal && this.message))) return this.defer();
    this.state = 'deferred-update';
    this.ackPromise = this.#callback(CallbackType.DeferredUpdate);
    return this.ackPromise;
  }

  async showModal(modalData) {
    if (this.state !== 'new') throw new Error('Cannot show a modal after the interaction was acknowledged.');
    if (this.bot.config?.debugValidate) {
      const problems = validateModal(modalData);
      if (problems.length) this.bot.log.warn(`modal problems for ${modalData.custom_id}:\n  ${problems.join('\n  ')}`);
    }
    this.state = 'modal';
    this.ackPromise = this.#callback(CallbackType.Modal, modalData);
    return this.ackPromise;
  }

  async autocomplete(choices) {
    if (this.state !== 'new') return undefined;
    this.state = 'replied';
    this.ackPromise = this.#callback(CallbackType.AutocompleteResult, { choices: choices.slice(0, 25) });
    return this.ackPromise;
  }

  async editReply(payload) {
    await this.#awaitPendingAck();
    const { body, files } = normalize(payload, { forEdit: true });
    return this.bot.rest.request('PATCH', `/webhooks/${this.raw.application_id}/${this.token}/messages/@original`, { body, files });
  }

  async followUp(payload) {
    await this.#awaitPendingAck();
    const { body, files } = normalize(payload);
    return this.bot.rest.request('POST', `/webhooks/${this.raw.application_id}/${this.token}`, { body, files });
  }

  async deleteReply() {
    await this.#awaitPendingAck();
    return this.bot.rest.request('DELETE', `/webhooks/${this.raw.application_id}/${this.token}/messages/@original`).catch(() => null);
  }
}

export class InteractionRouter {
  constructor(bot) {
    this.bot = bot;
    this.log = bot.log.child('interactions');
    this.commands = new Map();
    this.components = new Map();
    this.modals = new Map();
    /** @type {(error: UserError|Error, ctx: InteractionContext) => object} */
    this.renderError = (error) => ({ content: `⚠️ ${error.message}`, ephemeral: true });
  }

  /**
   * Register an application command.
   * def: { name, type?, description, options?, defaultMemberPermissions?, contexts?, run(ctx), autocomplete?(ctx), defer?: 'ephemeral'|'public' }
   */
  command(def) {
    const type = def.type || CommandType.ChatInput;
    this.commands.set(`${type}:${def.name}`, { ...def, type });
    return this;
  }

  /** Register a component handler for custom ids starting with `prefix:`. */
  component(prefix, handler) {
    this.components.set(prefix, handler);
    return this;
  }

  modal(prefix, handler) {
    this.modals.set(prefix, handler);
    return this;
  }

  /** JSON bodies for the bulk-overwrite command endpoint. */
  definitions() {
    return [...this.commands.values()].map((d) => {
      const json = { name: d.name, type: d.type };
      if (d.type === CommandType.ChatInput) {
        json.description = d.description;
        if (d.options?.length) json.options = d.options;
      }
      json.default_member_permissions = d.defaultMemberPermissions ?? null;
      json.contexts = d.contexts ?? [0];
      json.integration_types = d.integrationTypes ?? [0];
      if (d.nsfw) json.nsfw = true;
      return json;
    });
  }

  async dispatch(raw, { onContext } = {}) {
    const ctx = new InteractionContext(this.bot, raw);
    onContext?.(ctx);
    if (raw.type === InteractionType.Ping) return ctx;
    const started = Date.now();
    let handler;
    let args = [];
    let deferMode = 'ephemeral';

    if (raw.type === InteractionType.ApplicationCommand || raw.type === InteractionType.Autocomplete) {
      const def = this.commands.get(`${raw.data.type || 1}:${raw.data.name}`);
      if (!def) {
        this.log.warn(`unknown command ${raw.data.name}`);
        if (raw.type === InteractionType.ApplicationCommand) await ctx.reply(this.renderError(new UserError('That command is no longer available.'), ctx)).catch(() => null);
        return ctx;
      }
      if (raw.type === InteractionType.Autocomplete) {
        try {
          await (def.autocomplete ? def.autocomplete(ctx) : ctx.autocomplete([]));
        } catch (err) {
          this.log.warn(`autocomplete ${def.name} failed`, err);
          await ctx.autocomplete([]).catch(() => null);
        }
        return ctx;
      }
      handler = def.run;
      deferMode = def.defer || 'ephemeral';
    } else {
      const parts = (raw.data.custom_id || '').split(':');
      const registry = raw.type === InteractionType.ModalSubmit ? this.modals : this.components;
      handler = registry.get(parts[0]);
      args = parts.slice(1);
      deferMode = 'update';
      if (!handler) {
        await ctx.reply(this.renderError(new UserError('This panel has expired. Run the command again to open a fresh one.', { title: 'Panel expired', tone: 'warning' }), ctx)).catch(() => null);
        return ctx;
      }
    }

    const safety = setTimeout(() => {
      if (ctx.state !== 'new') return;
      if (deferMode === 'update') ctx.deferUpdate().catch((e) => this.log.debug('auto deferUpdate failed', e.message));
      else ctx.defer({ ephemeral: deferMode !== 'public' }).catch((e) => this.log.debug('auto defer failed', e.message));
    }, 2_300);

    try {
      await handler(ctx, ...args);
    } catch (err) {
      await this.#handleError(ctx, err);
    } finally {
      clearTimeout(safety);
      const elapsed = Date.now() - started;
      if (elapsed > 2_000) this.log.debug(`slow interaction ${ctx.commandName || ctx.customId} took ${elapsed}ms`);
    }
    return ctx;
  }

  async #handleError(ctx, err) {
    const isUser = err instanceof UserError;
    if (!isUser) {
      if (err instanceof DiscordAPIError && (err.code === 10062 || err.code === 40060)) {
        this.log.warn(`interaction ${ctx.commandName || ctx.customId} could not be answered (${err.code}: ${err.apiMessage})`);
        return;
      }
      this.log.error(`handler failed for ${ctx.commandName || ctx.customId}`, err);
    }
    const payload = this.renderError(isUser ? err : new UserError('Something went wrong while processing that. The incident was logged for the staff team.', { title: 'System fault' }), ctx);
    try {
      if (ctx.state === 'new') await ctx.reply(payload);
      else if (ctx.state === 'deferred') await ctx.editReply(payload);
      else await ctx.followUp({ ...payload, ephemeral: true });
    } catch (e) {
      this.log.debug('could not deliver error message', e.message);
    }
  }
}
