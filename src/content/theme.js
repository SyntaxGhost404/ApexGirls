// Visual identity of the bot: the "Sanctuary Core" — the in-world terminal of a Sanctuary,
// which in Apex Girls lore can airdrop supplies and call in reinforcements.

export const BRAND = {
  system: 'Sanctuary Core',
  short: 'SANCTUARY CORE',
  network: 'Commander Network',
  footer: 'Sanctuary Core · Apex Girls community',
};

export const COLORS = {
  primary: 0xe5446d, // scarlet rose
  accent: 0x8e5cff, // stellar violet
  info: 0x3fa9f5,
  success: 0x3bd67f,
  warning: 0xf5a524,
  danger: 0xf04452,
  gold: 0xf2c14e,
  steel: 0x5b6b82,
  dark: 0x1e1f29,
};

export const ICON = {
  xp: '✦',
  level: '⬆️',
  streak: '🔥',
  airdrop: '📦',
  quest: '🎯',
  shop: '🛒',
  inventory: '🎒',
  breach: '🚨',
  trophy: '🏆',
  voice: '🎙️',
  chat: '💬',
  rank: '🎖️',
  faction: '🏳️',
  giveaway: '🎁',
  expedition: '🧭',
  duel: '⚔️',
  relic: '🏺',
  ok: '✅',
  no: '❌',
  lock: '🔒',
  clock: '⏳',
  info: 'ℹ️',
  warn: '⚠️',
  staff: '🛠️',
  archive: '📚',
  code: '🎟️',
  id: '🪪',
  boost: '🚀',
  shield: '🛡️',
  season: '🏁',
  star: '⭐',
  spark: '✨',
  signal: '📡',
  trivia: '🔐',
  surge: '🌊',
  requisition: '📮',
  settings: '⚙️',
  back: '↩️',
  prev: '◀️',
  next: '▶️',
  first: '⏮️',
  last: '⏭️',
  refresh: '🔄',
  me: '📍',
};

/** Commander ranks (lore-themed titles) unlocked by lifetime level. */
export const RANKS = [
  { min: 0, name: 'Drifter', emoji: '🧭', blurb: 'Wandering the Wildness, looking for a Sanctuary to call home.' },
  { min: 5, name: 'Pioneer', emoji: '🏕️', blurb: 'Carrying a projection core into the unknown.' },
  { min: 10, name: 'Scout', emoji: '🔭', blurb: 'Eyes on the blockade zones.' },
  { min: 15, name: 'Field Agent', emoji: '🎯', blurb: 'Trusted with missions beyond the walls.' },
  { min: 20, name: 'Sanctuary Guard', emoji: '🛡️', blurb: 'Holding the line when the Mechs come.' },
  { min: 30, name: 'Core Warden', emoji: '⚙️', blurb: 'Keeper of a Sanctuary Core.' },
  { min: 40, name: 'Sanctuary Commander', emoji: '🎖️', blurb: 'Leads a Sanctuary and its Stellaris.' },
  { min: 50, name: 'Wall Marshal', emoji: '🏰', blurb: 'Answers to Pax itself.' },
  { min: 65, name: 'Stellar Vanguard', emoji: '🌠', blurb: 'First into every Calamity breach.' },
  { min: 80, name: 'Arcana Commander', emoji: '🃏', blurb: 'Spoken of alongside the twenty-two.' },
  { min: 100, name: 'Apex Commander', emoji: '👑', blurb: 'A legend of the Commander Network.' },
];

export function rankFor(level) {
  let current = RANKS[0];
  for (const r of RANKS) if (level >= r.min) current = r;
  return current;
}

export function nextRank(level) {
  return RANKS.find((r) => r.min > level) || null;
}

/** In-game factions (elements). Four form a counter loop; Nebula is neutral. */
export const FACTIONS = {
  inferno: { key: 'inferno', name: 'Inferno', emoji: '🔥', color: 0xff6b35, beats: 'rancor', motto: 'Burn bright, burn first.' },
  rancor: { key: 'rancor', name: 'Rancor', emoji: '☣️', color: 0x5bbf4f, beats: 'flare', motto: 'Nothing withstands the venom.' },
  flare: { key: 'flare', name: 'Flare', emoji: '⚡', color: 0xffc83d, beats: 'void', motto: 'Light splits the dark.' },
  void: { key: 'void', name: 'Void', emoji: '🌑', color: 0x8e5cff, beats: 'inferno', motto: 'Every fire goes out.' },
  nebula: { key: 'nebula', name: 'Nebula', emoji: '🌌', color: 0x4fc3f7, beats: null, motto: 'Beyond every loop.' },
};
export const FACTION_KEYS = Object.keys(FACTIONS);

/** +1 when `a` counters `b`, -1 when `b` counters `a`, 0 otherwise (Nebula is always neutral). */
export function matchup(a, b) {
  if (!a || !b || a === b) return 0;
  if (FACTIONS[a]?.beats === b) return 1;
  if (FACTIONS[b]?.beats === a) return -1;
  return 0;
}

export function counterOf(element) {
  return FACTION_KEYS.find((k) => FACTIONS[k].beats === element) || null;
}

export const REGIONS = {
  global: { key: 'global', label: 'Global', game: 'Apex Girls: 3650-Pull Giveaway', emoji: '🌍' },
  sea: { key: 'sea', label: 'Southeast Asia', game: 'Scarlet Girls - Elite Edition', emoji: '🌏' },
};

export const CLASSES = {
  assaulter: { name: 'Assaulter', emoji: '⚔️', role: 'Physical damage' },
  devastator: { name: 'Devastator', emoji: '💥', role: 'Energy damage' },
  defender: { name: 'Defender', emoji: '🛡️', role: 'Tank — taunts and shields' },
  support: { name: 'Support', emoji: '🩹', role: 'Heals, buffs and debuffs' },
};
