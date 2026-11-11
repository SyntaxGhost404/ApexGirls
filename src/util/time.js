// Time helpers. All periods are UTC-based with a configurable reset hour.
export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
const DISCORD_EPOCH = 1420070400000n;

/** Integer day index; days roll over at `resetHour` UTC. */
export function dayKey(ts = Date.now(), resetHour = 0) {
  return Math.floor((ts - resetHour * HOUR) / DAY);
}

export function dayStart(key, resetHour = 0) {
  return key * DAY + resetHour * HOUR;
}

export function nextDayReset(ts = Date.now(), resetHour = 0) {
  return dayStart(dayKey(ts, resetHour) + 1, resetHour);
}

/** Integer week index; weeks start on Monday at `resetHour` UTC (1970-01-01 was a Thursday). */
export function weekKey(ts = Date.now(), resetHour = 0) {
  return Math.floor((dayKey(ts, resetHour) + 3) / 7);
}

export function weekStart(key, resetHour = 0) {
  return dayStart(key * 7 - 3, resetHour);
}

export function nextWeekReset(ts = Date.now(), resetHour = 0) {
  return weekStart(weekKey(ts, resetHour) + 1, resetHour);
}

/** Calendar-month season key like "2026-11" (month boundaries honour the reset hour). */
export function monthKey(ts = Date.now(), resetHour = 0) {
  const d = new Date(ts - resetHour * HOUR);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function nextMonthReset(ts = Date.now(), resetHour = 0) {
  const d = new Date(ts - resetHour * HOUR);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) + resetHour * HOUR;
}

/** Period key for purchase limits / stock windows. */
export function periodKey(period, ts = Date.now(), resetHour = 0) {
  switch (period) {
    case 'daily': return `d${dayKey(ts, resetHour)}`;
    case 'weekly': return `w${weekKey(ts, resetHour)}`;
    case 'monthly': return `m${monthKey(ts, resetHour)}`;
    case 'lifetime': return 'life';
    default: return null;
  }
}

/** Start timestamp of the window a period key belongs to. */
export function periodStart(period, ts = Date.now(), resetHour = 0) {
  switch (period) {
    case 'daily': return dayStart(dayKey(ts, resetHour), resetHour);
    case 'weekly': return weekStart(weekKey(ts, resetHour), resetHour);
    case 'monthly': {
      const d = new Date(ts - resetHour * HOUR);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + resetHour * HOUR;
    }
    case 'lifetime': return 0;
    default: return 0;
  }
}

/** Discord timestamp markdown, e.g. <t:1700000000:R>. */
export function discordTime(ms, style = 'R') {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

export function snowflakeTime(id) {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

const UNIT = { s: SECOND, m: MINUTE, h: HOUR, d: DAY, w: WEEK };

/** Parse "90m", "2h30m", "1d", "45" (minutes) into milliseconds. Returns null on failure. */
export function parseDuration(input) {
  const s = String(input || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) * MINUTE;
  const re = /(\d+(?:\.\d+)?)(w|d|h|m|s)/g;
  let total = 0;
  let consumed = 0;
  let m;
  while ((m = re.exec(s))) {
    total += Number(m[1]) * UNIT[m[2]];
    consumed += m[0].length;
  }
  return consumed === s.length && total > 0 ? Math.round(total) : null;
}

export function formatDuration(ms, { short = true } = {}) {
  let rest = Math.max(0, Math.round(ms / 1000));
  const parts = [];
  for (const [label, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n) parts.push(short ? `${n}${label}` : `${n} ${{ d: 'day', h: 'hour', m: 'minute', s: 'second' }[label]}${n === 1 ? '' : 's'}`);
  }
  return parts.slice(0, 2).join(' ') || (short ? '0s' : '0 seconds');
}
