// Formatting helpers for chat-facing text.

export const num = (n) => Number(n || 0).toLocaleString('en-US');

export function compact(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(v) >= 10_000) return `${(v / 1_000).toFixed(v >= 100_000 ? 0 : 1)}k`;
  return num(v);
}

export function plural(n, word, pluralWord = `${word}s`) {
  return `${num(n)} ${Math.abs(n) === 1 ? word : pluralWord}`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function medal(rank) {
  return ['🥇', '🥈', '🥉'][rank - 1] || `\`#${String(rank).padStart(2, ' ')}\``;
}

export function percent(value, total, digits = 0) {
  if (!total) return '0%';
  return `${((value / total) * 100).toFixed(digits)}%`;
}

/** Plain Unicode progress bar, e.g. ▰▰▰▱▱▱. */
export function bar(value, max, size = 10, { full = '▰', empty = '▱' } = {}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * size);
  return full.repeat(filled) + empty.repeat(size - filled);
}

/** Escape Discord markdown in user-provided text. */
export function escapeMarkdown(input) {
  return String(input ?? '').replace(/([\\*_`~|>#\-[\]()])/g, '\\$1').replace(/@(everyone|here)/g, '@\u200b$1');
}

/** Remove mention syntax entirely from user text (for names in announcements). */
export function sanitizeInline(input, max = 100) {
  const cleaned = String(input ?? '').replace(/[\r\n]+/g, ' ').replace(/<[@#][!&]?\d+>/g, '').trim();
  return escapeMarkdown(cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned);
}

export function titleCase(s) {
  return String(s).replace(/(^|[\s_-])(\w)/g, (_, sep, c) => `${sep === '_' ? ' ' : sep}${c.toUpperCase()}`);
}

export function list(items, conj = 'and') {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`;
}

export const mention = (id) => `<@${id}>`;
export const channelMention = (id) => `<#${id}>`;
export const roleMention = (id) => `<@&${id}>`;

/** Avatar URL for a user (guild avatar when provided), falling back to the default avatar. */
export function avatarUrl(user, { guildId, guildAvatar, size = 256 } = {}) {
  if (!user) return 'https://cdn.discordapp.com/embed/avatars/0.png';
  if (guildId && guildAvatar) {
    const ext = guildAvatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${guildAvatar}.${ext}?size=${size}`;
  }
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
  }
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function displayName(user, member) {
  return member?.nick || user?.global_name || user?.globalName || user?.username || 'Commander';
}
