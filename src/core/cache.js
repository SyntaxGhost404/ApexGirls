// Lean gateway state cache: only what the bot needs (guild meta, roles, channels, threads,
// voice states, the bot's own member). Snapshots allow resuming a session across restarts.

const CHANNEL_OBFUSCATED = 1 << 17;
const THREAD_TYPES = new Set([10, 11, 12]);

function slimRole(r) {
  return { id: r.id, name: r.name, permissions: r.permissions, position: r.position, managed: Boolean(r.managed), color: r.color ?? 0 };
}

function slimChannel(c) {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    parentId: c.parent_id ?? null,
    position: c.position ?? 0,
    overwrites: (c.permission_overwrites || []).map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })),
    flags: c.flags ?? 0,
    hidden: Boolean((c.flags ?? 0) & CHANNEL_OBFUSCATED) || c.name === '___hidden___',
  };
}

class LRU {
  constructor(max = 5_000) {
    this.max = max;
    this.map = new Map();
  }
  get(key) {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  delete(key) { this.map.delete(key); }
}

export class Cache {
  constructor() {
    this.user = null;
    this.applicationId = null;
    this.guilds = new Map();
    this.members = new LRU(10_000);
    this.dmChannels = new Map();
  }

  reset() {
    this.guilds.clear();
  }

  guild(id) {
    return this.guilds.get(id) || null;
  }

  /** Channel or thread lookup. Threads resolve to a synthetic channel with `parentId`. */
  channel(guildId, channelId) {
    const g = this.guilds.get(guildId);
    if (!g) return null;
    return g.channels.get(channelId) || g.threads.get(channelId) || null;
  }

  /** The channel whose permission overwrites apply (threads inherit from their parent). */
  permissionChannel(guildId, channelId) {
    const c = this.channel(guildId, channelId);
    if (!c) return null;
    if (THREAD_TYPES.has(c.type) && c.parentId) return this.channel(guildId, c.parentId) || c;
    return c;
  }

  /** All ids that identify where a message lives: the channel, its parent channel and category. */
  channelLineage(guildId, channelId) {
    const ids = [channelId];
    let current = this.channel(guildId, channelId);
    let guard = 0;
    while (current?.parentId && guard < 3) {
      ids.push(current.parentId);
      current = this.channel(guildId, current.parentId);
      guard += 1;
    }
    return ids;
  }

  rememberMember(guildId, user, member) {
    if (!user?.id) return;
    const key = `${guildId}:${user.id}`;
    const previous = this.members.get(key) || {};
    this.members.set(key, {
      id: user.id,
      username: user.username ?? previous.username,
      globalName: user.global_name ?? previous.globalName ?? null,
      avatar: user.avatar ?? previous.avatar ?? null,
      bot: Boolean(user.bot ?? previous.bot),
      nick: member?.nick ?? previous.nick ?? null,
      guildAvatar: member?.avatar ?? previous.guildAvatar ?? null,
      roles: member?.roles ?? previous.roles ?? [],
      premiumSince: member?.premium_since ?? previous.premiumSince ?? null,
    });
  }

  member(guildId, userId) {
    return this.members.get(`${guildId}:${userId}`) || null;
  }

  #ensureGuild(id) {
    let g = this.guilds.get(id);
    if (!g) {
      g = { id, name: 'Unknown', ownerId: null, afkChannelId: null, memberCount: 0, icon: null, unavailable: false, me: { roles: [] }, roles: new Map(), channels: new Map(), threads: new Map(), voice: new Map() };
      this.guilds.set(id, g);
    }
    return g;
  }

  #applyGuild(d) {
    const g = this.#ensureGuild(d.id);
    g.name = d.name ?? g.name;
    g.ownerId = d.owner_id ?? g.ownerId;
    g.afkChannelId = d.afk_channel_id ?? g.afkChannelId ?? null;
    g.icon = d.icon ?? g.icon ?? null;
    if (d.member_count !== undefined) g.memberCount = d.member_count;
    g.unavailable = Boolean(d.unavailable);
    if (Array.isArray(d.roles)) {
      g.roles.clear();
      for (const r of d.roles) g.roles.set(r.id, slimRole(r));
    }
    return g;
  }

  #voiceFrom(vs) {
    return {
      channelId: vs.channel_id,
      selfMute: Boolean(vs.self_mute),
      selfDeaf: Boolean(vs.self_deaf),
      mute: Boolean(vs.mute),
      deaf: Boolean(vs.deaf),
      suppress: Boolean(vs.suppress),
      bot: Boolean(vs.member?.user?.bot),
      since: Date.now(),
    };
  }

  /** Feed a gateway dispatch into the cache. */
  handle(t, d) {
    switch (t) {
      case 'READY':
        this.user = d.user;
        this.applicationId = d.application?.id ?? this.applicationId;
        this.reset();
        for (const g of d.guilds || []) this.#ensureGuild(g.id).unavailable = true;
        break;
      case 'GUILD_CREATE': {
        const g = this.#applyGuild(d);
        if (d.unavailable) break;
        g.channels.clear();
        for (const c of d.channels || []) g.channels.set(c.id, slimChannel(c));
        g.threads.clear();
        for (const th of d.threads || []) g.threads.set(th.id, slimChannel(th));
        const bots = new Set();
        for (const m of d.members || []) {
          if (m.user?.bot) bots.add(m.user.id);
          if (m.user?.id === this.user?.id) g.me.roles = m.roles || [];
          this.rememberMember(d.id, m.user, m);
        }
        g.voice.clear();
        for (const vs of d.voice_states || []) {
          if (!vs.channel_id) continue;
          const state = this.#voiceFrom(vs);
          state.bot = state.bot || bots.has(vs.user_id);
          g.voice.set(vs.user_id, state);
        }
        break;
      }
      case 'GUILD_UPDATE':
        this.#applyGuild(d);
        break;
      case 'GUILD_DELETE':
        if (d.unavailable) this.#ensureGuild(d.id).unavailable = true;
        else this.guilds.delete(d.id);
        break;
      case 'GUILD_ROLE_CREATE':
      case 'GUILD_ROLE_UPDATE':
        this.#ensureGuild(d.guild_id).roles.set(d.role.id, slimRole(d.role));
        break;
      case 'GUILD_ROLE_DELETE':
        this.guilds.get(d.guild_id)?.roles.delete(d.role_id);
        break;
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
        if (d.guild_id) this.#ensureGuild(d.guild_id).channels.set(d.id, slimChannel(d));
        break;
      case 'CHANNEL_DELETE':
        if (d.guild_id) this.guilds.get(d.guild_id)?.channels.delete(d.id);
        break;
      case 'THREAD_CREATE':
      case 'THREAD_UPDATE':
        if (d.guild_id) this.#ensureGuild(d.guild_id).threads.set(d.id, slimChannel(d));
        break;
      case 'THREAD_DELETE':
        if (d.guild_id) this.guilds.get(d.guild_id)?.threads.delete(d.id);
        break;
      case 'THREAD_LIST_SYNC':
        for (const th of d.threads || []) this.#ensureGuild(d.guild_id).threads.set(th.id, slimChannel(th));
        break;
      case 'VOICE_STATE_UPDATE': {
        if (!d.guild_id) break;
        const g = this.#ensureGuild(d.guild_id);
        if (d.member?.user) this.rememberMember(d.guild_id, d.member.user, d.member);
        if (!d.channel_id) g.voice.delete(d.user_id);
        else {
          const prev = g.voice.get(d.user_id);
          const next = this.#voiceFrom(d);
          if (prev && prev.channelId === next.channelId) next.since = prev.since;
          g.voice.set(d.user_id, next);
        }
        break;
      }
      case 'GUILD_MEMBER_ADD':
        this.rememberMember(d.guild_id, d.user, d);
        if (this.guilds.get(d.guild_id)) this.guilds.get(d.guild_id).memberCount += 1;
        break;
      case 'GUILD_MEMBER_UPDATE':
        if (d.user?.id === this.user?.id) this.#ensureGuild(d.guild_id).me.roles = d.roles || [];
        this.rememberMember(d.guild_id, d.user, d);
        break;
      case 'GUILD_MEMBER_REMOVE':
        this.members.delete(`${d.guild_id}:${d.user?.id}`);
        if (this.guilds.get(d.guild_id)) this.guilds.get(d.guild_id).memberCount = Math.max(0, this.guilds.get(d.guild_id).memberCount - 1);
        break;
      case 'MESSAGE_CREATE':
        if (d.guild_id && d.author && !d.webhook_id) this.rememberMember(d.guild_id, d.author, d.member);
        break;
      default:
        break;
    }
  }

  toJSON() {
    return {
      user: this.user,
      applicationId: this.applicationId,
      guilds: [...this.guilds.values()].map((g) => ({
        ...g,
        roles: [...g.roles.values()],
        channels: [...g.channels.values()],
        threads: [...g.threads.values()],
        voice: [...g.voice.entries()],
      })),
    };
  }

  load(snapshot) {
    if (!snapshot) return false;
    this.user = snapshot.user;
    this.applicationId = snapshot.applicationId;
    this.guilds.clear();
    for (const g of snapshot.guilds || []) {
      this.guilds.set(g.id, {
        ...g,
        roles: new Map(g.roles.map((r) => [r.id, r])),
        channels: new Map(g.channels.map((c) => [c.id, c])),
        threads: new Map(g.threads.map((c) => [c.id, c])),
        voice: new Map(g.voice),
      });
    }
    return true;
  }
}
