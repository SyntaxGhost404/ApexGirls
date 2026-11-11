// Default per-guild configuration, starter Supply Depot catalogue and the Directive (quest) pool.
// Every number here can be changed by staff from /setup without touching code.

export const DEFAULT_SETTINGS = {
  general: {
    resetHour: 0, // UTC hour when daily/weekly/monthly periods roll over
    staffRoleIds: [],
    logChannelId: null,
  },
  branding: {
    currencyName: 'Core Shards',
    currencyEmoji: '💠',
    bannerUrl: '',
  },
  leveling: {
    enabled: true,
    chatXpMin: 15,
    chatXpMax: 25,
    cooldownSec: 60,
    minChars: 6,
    softCap: 1500, // daily chat XP after which gains are halved
    hardCap: 3000, // daily chat XP after which chat stops earning XP
    conversationBonus: 20, // % bonus for replying to / chatting with others
    shardsPerMessage: 2,
    chatShardsDailyCap: 120,
    curveScale: 100, // % of the standard XP curve
    levelShardsBase: 20,
    levelShardsPerLevel: 5,
    noXpChannelIds: [],
    noXpRoleIds: [],
    channelMultipliers: {}, // channelId → %
    roleMultipliers: {}, // roleId → %
    rewards: [], // [{ level, roleId }]
    stackRewards: true,
    announceMode: 'current', // current | channel | dm | off
    announceChannelId: null,
    announcePing: true,
    announceFromLevel: 2,
  },
  voice: {
    enabled: true,
    xpPerMinute: 5,
    shardsPer10Min: 3,
    dailyXpCap: 600,
    requireUnmuted: true,
    minHumans: 2,
  },
  economy: {
    dailyBase: 100,
    streakBonus: 10,
    streakBonusCap: 150,
    milestone7: 250,
    milestone30: 1000,
  },
  quests: {
    enabled: true,
    dailyCount: 3,
    weeklyCount: 3,
    allClearBonus: 150,
  },
  events: {
    channelId: null,
    dropsEnabled: true,
    dropChannelIds: [],
    dropChancePermille: 10, // per XP-earning message in a drop channel
    dropMaxPerDay: 6,
    dropCooldownMin: 45,
    dropClaimers: 5,
    dropRewardMin: 40,
    dropRewardMax: 120,
    dropMinLevel: 1,
    breachAuto: false,
    breachWindowStart: 14,
    breachWindowEnd: 22,
    breachDurationMin: 20,
    breachRewardPool: 3000,
    triviaRewardFirst: 120,
    triviaRewardOthers: 40,
    triviaWinners: 3,
    triviaSeconds: 45,
  },
  factions: {
    enabled: true,
    roleIds: { inferno: null, rancor: null, flare: null, void: null, nebula: null },
    weeklyReward: 200,
    minContribution: 150,
    contributionCap: 2500,
    switchCooldownDays: 14,
  },
  shop: {
    requisitionChannelId: null,
  },
  welcome: {
    enabled: false,
    channelId: null,
    message: 'A new Commander has reached the Sanctuary. Welcome aboard, {user}!',
  },
  seasons: {
    enabled: true,
    rewards: [3000, 2000, 1500, 750, 750, 500, 500, 500, 500, 500],
  },
  expeditions: {
    enabled: true,
    dailyLaunches: 3,
  },
  duels: {
    enabled: true,
    maxStake: 500,
    dailyLimit: 10,
    taxPercent: 5,
  },
  giveaways: {
    hostRoleIds: [],
  },
};

/** Starter catalogue seeded once per guild. In-game rewards start disabled until staff confirm them. */
export const DEFAULT_SHOP = [
  { kind: 'title', name: 'Wildness Wanderer', emoji: '🧭', price: 1000, description: 'Profile title for Commanders who roam beyond the walls.', data: { title: 'Wildness Wanderer' } },
  { kind: 'title', name: 'Pax Sentinel', emoji: '🛡️', price: 2500, min_level: 10, description: 'Profile title. Requires level 10.', data: { title: 'Pax Sentinel' } },
  { kind: 'title', name: 'Calamity Breaker', emoji: '💥', price: 5000, min_level: 20, description: 'Profile title. Requires level 20.', data: { title: 'Calamity Breaker' } },
  { kind: 'title', name: 'Arcana Strategist', emoji: '🃏', price: 10000, min_level: 35, description: 'Profile title. Requires level 35.', data: { title: 'Arcana Strategist' } },
  { kind: 'accent', name: 'Scarlet Signal', emoji: '🟥', price: 1500, description: 'Paints your Commander ID card scarlet.', data: { color: 0xe5446d } },
  { kind: 'accent', name: 'Void Bloom', emoji: '🟪', price: 1500, description: 'Paints your Commander ID card violet.', data: { color: 0x8e5cff } },
  { kind: 'accent', name: 'Flare Gold', emoji: '🟨', price: 1500, description: 'Paints your Commander ID card gold.', data: { color: 0xffc83d } },
  { kind: 'accent', name: 'Nebula Tide', emoji: '🟦', price: 1500, description: 'Paints your Commander ID card cyan.', data: { color: 0x4fc3f7 } },
  { kind: 'consumable', name: 'Streak Shield', emoji: '🛡️', price: 600, limit_count: 2, limit_period: 'weekly', description: 'Protects your Supply Airdrop streak once if you miss a day. Used automatically.', data: { effect: 'streak_shield' } },
  { kind: 'consumable', name: 'Resonance Booster', emoji: '🚀', price: 800, limit_count: 3, limit_period: 'weekly', description: '+25% XP for 60 minutes. Activate it from /inventory.', data: { effect: 'xp_boost', percent: 125, minutes: 60 } },
  { kind: 'fulfillment', name: 'Advanced Echo Permit ×1', emoji: '🎴', price: 6000, min_level: 10, limit_count: 1, limit_period: 'monthly', stock: 20, stock_period: 'monthly', enabled: false, description: 'In-game reward delivered to your mailbox by staff. Requires your UID.' },
  { kind: 'fulfillment', name: 'Diamonds ×300', emoji: '💎', price: 4500, min_level: 5, limit_count: 1, limit_period: 'monthly', stock: 30, stock_period: 'monthly', enabled: false, description: 'In-game reward delivered to your mailbox by staff. Requires your UID.' },
  { kind: 'fulfillment', name: 'Purification Metal ×100', emoji: '⚗️', price: 3000, limit_count: 2, limit_period: 'monthly', stock: 40, stock_period: 'monthly', enabled: false, description: 'In-game reward delivered to your mailbox by staff. Requires your UID.' },
  { kind: 'fulfillment', name: 'SSR+ Stellaris Selection Box', emoji: '🌟', price: 40000, min_level: 30, limit_count: 1, limit_period: 'monthly', stock: 2, stock_period: 'monthly', enabled: false, description: 'Premium in-game reward fulfilled by staff. Requires your UID.' },
];

export const ITEM_KINDS = {
  title: { label: 'Profile title', emoji: '🏷️', hint: 'Cosmetic title shown on the Commander ID card.' },
  accent: { label: 'Card accent', emoji: '🎨', hint: 'Colour of the Commander ID card.' },
  role: { label: 'Discord role', emoji: '🎭', hint: 'Grants a server role (optionally for N days).' },
  consumable: { label: 'Consumable', emoji: '🧪', hint: 'Streak Shield or Resonance Booster.' },
  fulfillment: { label: 'In-game reward', emoji: '📮', hint: 'Creates a requisition that staff fulfil in game (UID required).' },
};

export const PERIODS = {
  none: 'No limit',
  daily: 'per day',
  weekly: 'per week',
  monthly: 'per month',
  lifetime: 'ever',
};

/**
 * Directive pool. `event` is the activity stream that advances it; `distinct` counts unique targets.
 * `requires` hides the directive when the related module is disabled.
 */
export const QUEST_POOL = {
  daily: [
    { key: 'd_messages', event: 'message', targets: [15, 25, 35], text: (t) => `Send ${t} messages that earn XP`, reward: (t) => ({ shards: 40 + t * 2, xp: 50 + t * 2 }) },
    { key: 'd_replies', event: 'reply', distinct: true, targets: [3, 5], text: (t) => `Reply to ${t} different Commanders`, reward: (t) => ({ shards: 50 + t * 10, xp: 60 }) },
    { key: 'd_voice', event: 'voice', requires: 'voice', targets: [20, 30, 45], text: (t) => `Spend ${t} minutes in voice with others`, reward: (t) => ({ shards: 40 + t * 2, xp: 60 }) },
    { key: 'd_daily', event: 'daily', targets: [1], text: () => 'Claim your Supply Airdrop', reward: () => ({ shards: 40, xp: 40 }) },
    { key: 'd_xp', event: 'xp', targets: [300, 500], text: (t) => `Earn ${t} XP`, reward: (t) => ({ shards: 60 + t / 10, xp: 0 }) },
    { key: 'd_reactions', event: 'reaction', distinct: true, targets: [5, 10], text: (t) => `React to ${t} different messages`, reward: (t) => ({ shards: 30 + t * 3, xp: 30 }) },
    { key: 'd_expedition', event: 'expedition', requires: 'expeditions', targets: [1], text: () => 'Return from an expedition', reward: () => ({ shards: 50, xp: 50 }) },
  ],
  weekly: [
    { key: 'w_xp', event: 'xp', targets: [3000, 5000], text: (t) => `Earn ${t.toLocaleString('en-US')} XP`, reward: (t) => ({ shards: 250 + t / 20, xp: 0 }) },
    { key: 'w_daily', event: 'daily', targets: [5], text: () => 'Claim the Supply Airdrop on 5 days', reward: () => ({ shards: 350, xp: 200 }) },
    { key: 'w_events', event: 'event', requires: 'events', targets: [2, 3], text: (t) => `Take part in ${t} server events`, reward: (t) => ({ shards: 200 + t * 100, xp: 200 }) },
    { key: 'w_voice', event: 'voice', requires: 'voice', targets: [120, 180], text: (t) => `Spend ${t} minutes in voice`, reward: (t) => ({ shards: 200 + t, xp: 200 }) },
    { key: 'w_replies', event: 'reply', distinct: true, targets: [15], text: () => 'Reply to 15 different Commanders', reward: () => ({ shards: 400, xp: 250 }) },
    { key: 'w_trivia', event: 'trivia', requires: 'events', targets: [2], text: () => 'Crack 2 Signal Decryptions (trivia)', reward: () => ({ shards: 300, xp: 150 }) },
    { key: 'w_expeditions', event: 'expedition', requires: 'expeditions', targets: [5], text: () => 'Complete 5 expeditions', reward: () => ({ shards: 300, xp: 200 }) },
    { key: 'w_duels', event: 'duel_win', requires: 'duels', targets: [2], text: () => 'Win 2 Faction Clash duels', reward: () => ({ shards: 250, xp: 150 }) },
  ],
};
