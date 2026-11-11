// Permission bitflags and channel permission computation (base + overwrites), per Discord docs.

export const P = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  CONNECT: 1n << 20n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n,
  CREATE_EVENTS: 1n << 44n,
  PIN_MESSAGES: 1n << 51n,
};
export const ALL_PERMISSIONS = (1n << 64n) - 1n;

export function toBig(value) {
  if (typeof value === 'bigint') return value;
  if (value === null || value === undefined || value === '') return 0n;
  return BigInt(value);
}

export function has(perms, flag) {
  const p = toBig(perms);
  if ((p & P.ADMINISTRATOR) === P.ADMINISTRATOR) return true;
  return (p & flag) === flag;
}

export function basePermissions(guild, userId, roleIds = []) {
  if (!guild) return 0n;
  if (guild.ownerId && guild.ownerId === userId) return ALL_PERMISSIONS;
  let perms = toBig(guild.roles.get(guild.id)?.permissions);
  for (const id of roleIds) perms |= toBig(guild.roles.get(id)?.permissions);
  if ((perms & P.ADMINISTRATOR) === P.ADMINISTRATOR) return ALL_PERMISSIONS;
  return perms;
}

export function applyOverwrites(base, guild, channel, userId, roleIds = []) {
  if ((base & P.ADMINISTRATOR) === P.ADMINISTRATOR) return ALL_PERMISSIONS;
  if (!channel) return base;
  let perms = base;
  const overwrites = channel.overwrites || [];
  const everyone = overwrites.find((o) => o.id === guild.id);
  if (everyone) {
    perms &= ~toBig(everyone.deny);
    perms |= toBig(everyone.allow);
  }
  let allow = 0n;
  let deny = 0n;
  for (const o of overwrites) {
    if (o.type === 0 && roleIds.includes(o.id)) {
      allow |= toBig(o.allow);
      deny |= toBig(o.deny);
    }
  }
  perms &= ~deny;
  perms |= allow;
  const member = overwrites.find((o) => o.type === 1 && o.id === userId);
  if (member) {
    perms &= ~toBig(member.deny);
    perms |= toBig(member.allow);
  }
  // Implicit permission: without VIEW_CHANNEL nothing else applies.
  if ((perms & P.VIEW_CHANNEL) !== P.VIEW_CHANNEL) return 0n;
  return perms;
}

/** Permissions of the bot user in a channel, computed from cached state. */
export function botChannelPermissions(cache, guildId, channelId) {
  const guild = cache.guild(guildId);
  const me = cache.user?.id;
  if (!guild || !me) return 0n;
  const channel = cache.permissionChannel(guildId, channelId);
  return applyOverwrites(basePermissions(guild, me, guild.me.roles), guild, channel, me, guild.me.roles);
}

export function botGuildPermissions(cache, guildId) {
  const guild = cache.guild(guildId);
  if (!guild || !cache.user) return 0n;
  return basePermissions(guild, cache.user.id, guild.me.roles);
}

export function highestRolePosition(guild, roleIds = []) {
  let top = 0;
  for (const id of roleIds) top = Math.max(top, guild.roles.get(id)?.position ?? 0);
  return top;
}

/** Whether the bot can assign `roleId` (permission + hierarchy + managed checks). */
export function canAssignRole(cache, guildId, roleId) {
  const guild = cache.guild(guildId);
  if (!guild) return { ok: false, reason: 'Guild is not cached yet.' };
  const role = guild.roles.get(roleId);
  if (!role) return { ok: false, reason: 'That role no longer exists.' };
  if (role.managed) return { ok: false, reason: `@${role.name} is managed by an integration.` };
  if (roleId === guild.id) return { ok: false, reason: '@everyone cannot be assigned.' };
  if (!has(botGuildPermissions(cache, guildId), P.MANAGE_ROLES)) return { ok: false, reason: 'The bot is missing the **Manage Roles** permission.' };
  const owner = guild.ownerId === cache.user?.id;
  if (!owner && highestRolePosition(guild, guild.me.roles) <= role.position) {
    return { ok: false, reason: `Move the bot's role above @${role.name} in Server Settings → Roles.` };
  }
  return { ok: true };
}

/** Check that the bot can post (optionally with embeds/files) in a channel. */
export function canPost(cache, guildId, channelId, { embeds = false, files = false } = {}) {
  const perms = botChannelPermissions(cache, guildId, channelId);
  const channel = cache.channel(guildId, channelId);
  const isThread = channel && [10, 11, 12].includes(channel.type);
  const missing = [];
  if (!has(perms, P.VIEW_CHANNEL)) missing.push('View Channel');
  if (!has(perms, isThread ? P.SEND_MESSAGES_IN_THREADS : P.SEND_MESSAGES)) missing.push(isThread ? 'Send Messages in Threads' : 'Send Messages');
  if (embeds && !has(perms, P.EMBED_LINKS)) missing.push('Embed Links');
  if (files && !has(perms, P.ATTACH_FILES)) missing.push('Attach Files');
  return { ok: missing.length === 0, missing };
}
