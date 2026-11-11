// XP curve: XP needed to go from level L to L+1 is 5L² + 50L + 100 (scaled by staff, in %).
// Gentle early levels, a long tail for veterans.

export const MAX_LEVEL = 500;

export function xpToNext(level, scalePct = 100) {
  return Math.max(1, Math.round(((5 * level * level + 50 * level + 100) * scalePct) / 100));
}

export function totalXpForLevel(level, scalePct = 100) {
  let total = 0;
  for (let l = 0; l < level; l += 1) total += xpToNext(l, scalePct);
  return total;
}

/** Level reached with `xp` lifetime XP, plus progress into the current level. */
export function levelProgress(xp, scalePct = 100) {
  let level = 0;
  let rest = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL) {
    const need = xpToNext(level, scalePct);
    if (rest < need) return { level, into: rest, needed: need, ratio: rest / need };
    rest -= need;
    level += 1;
  }
  return { level, into: 0, needed: 1, ratio: 1 };
}

export const levelFor = (xp, scalePct = 100) => levelProgress(xp, scalePct).level;

/** Core Shards granted for reaching `level`. */
export function levelShards(level, settings) {
  return Math.max(0, Math.round(settings.leveling.levelShardsBase + settings.leveling.levelShardsPerLevel * level));
}
