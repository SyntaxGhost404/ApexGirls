// High-level Discord helpers on top of the REST client.
import { DiscordAPIError } from './rest.js';

function body(payload) {
  const out = { ...payload };
  delete out.ephemeral;
  if (!out.allowed_mentions) out.allowed_mentions = { parse: [] };
  const files = out.files;
  delete out.files;
  return { body: out, files };
}

export function createApi(bot) {
  const { rest, cache, log } = bot;
  const dmFailures = new Map();

  return {
    async send(channelId, payload, { reason } = {}) {
      const { body: b, files } = body(payload);
      return rest.request('POST', `/channels/${channelId}/messages`, { body: b, files, reason });
    },

    async edit(channelId, messageId, payload) {
      const { body: b, files } = body(payload);
      return rest.request('PATCH', `/channels/${channelId}/messages/${messageId}`, { body: b, files });
    },

    async remove(channelId, messageId, reason) {
      return rest.request('DELETE', `/channels/${channelId}/messages/${messageId}`, { reason }).catch((err) => {
        if (!(err instanceof DiscordAPIError) || err.status !== 404) throw err;
        return null;
      });
    },

    async dmChannel(userId) {
      const cached = cache.dmChannels.get(userId);
      if (cached) return cached;
      const channel = await rest.post('/users/@me/channels', { recipient_id: userId });
      cache.dmChannels.set(userId, channel.id);
      return channel.id;
    },

    /** Send a DM; returns the message or null when the member has DMs closed. */
    async dm(userId, payload) {
      const blockedUntil = dmFailures.get(userId);
      if (blockedUntil && blockedUntil > Date.now()) return null;
      try {
        const channelId = await this.dmChannel(userId);
        return await this.send(channelId, payload);
      } catch (err) {
        if (err instanceof DiscordAPIError && (err.code === 50007 || err.status === 403)) {
          dmFailures.set(userId, Date.now() + 3_600_000);
          return null;
        }
        log.warn(`DM to ${userId} failed: ${err.message}`);
        return null;
      }
    },

    addRole(guildId, userId, roleId, reason) {
      return rest.request('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason });
    },

    removeRole(guildId, userId, roleId, reason) {
      return rest.request('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason });
    },

    async member(guildId, userId) {
      try {
        const m = await rest.get(`/guilds/${guildId}/members/${userId}`);
        cache.rememberMember(guildId, m.user, m);
        return m;
      } catch (err) {
        if (err instanceof DiscordAPIError && (err.code === 10007 || err.code === 10013)) return null;
        throw err;
      }
    },

    user(userId) {
      return rest.get(`/users/${userId}`);
    },

    async channel(channelId) {
      try {
        return await rest.get(`/channels/${channelId}`);
      } catch (err) {
        if (err instanceof DiscordAPIError && [10003, 50001].includes(err.code)) return null;
        throw err;
      }
    },
  };
}
