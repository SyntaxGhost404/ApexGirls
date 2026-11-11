// Randomness: crypto-backed for anything with stakes (giveaways, drops), seeded for stable assignments.
import { randomInt, createHash } from 'node:crypto';

/** Inclusive integer in [min, max]. */
export function randInt(min, max) {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo === hi ? lo : randomInt(lo, hi + 1);
}

export function randFloat(min = 0, max = 1) {
  return min + (randomInt(0, 2 ** 32) / 2 ** 32) * (max - min);
}

export function chance(p) {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return randomInt(0, 1_000_000) < Math.round(p * 1_000_000);
}

export function pick(list) {
  return list.length ? list[randomInt(0, list.length)] : undefined;
}

/** Unique random sample of up to n items (Fisher–Yates on a copy). */
export function sample(list, n) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, n));
}

export function weightedPick(items, weightOf) {
  const weights = items.map((i) => Math.max(0, weightOf(i)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  let r = randFloat(0, total);
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/** Deterministic PRNG (mulberry32) seeded from any string. */
export function seeded(seed) {
  let a = createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededSample(list, n, rng) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
