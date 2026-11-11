// Lore & game knowledge written for the community (original summaries — no copied text or art).
// Sources: the official Apex Girls website worldview, store listings and public game guides.

export const ARCHIVE = [
  {
    key: 'pax',
    title: 'Pax & the Wildness',
    emoji: '🏰',
    body: [
      'In the Old Era, ruins surfaced all over the world and brought the **Calamity Mechs** with them. Nation after nation fell.',
      'The survivors rallied behind **twenty-two commanders**, fought back with Stellari power and Purifier weaponry, and raised three colossal walls around the land they reclaimed: the city-state of **Pax**.',
      'Everything beyond the walls is the **Wildness** — ruins, blockade zones and Mech territory that Pax means to take back.',
    ],
  },
  {
    key: 'mechs',
    title: 'Calamity Mechs',
    emoji: '🦾',
    body: [
      'A Calamity Mech forms when a **Calamity Core** fuses with whatever matter surrounds it. The core is its life and its mind.',
      'As long as the core survives, the Mech can absorb material and rebuild itself — which is why field reports also call them *Ruin Machina* or disaster-machines.',
      'Their true origin is unknown. Their hostility toward humanity is not.',
    ],
  },
  {
    key: 'stellari',
    title: 'Stellari & Stellar Cores',
    emoji: '🌟',
    body: [
      'The first Stellari were humans who received Calamity Core implants; today the word covers anyone carrying a **Stellar Core**.',
      'Stellari far outclass ordinary soldiers and, crucially, can destroy a Calamity Core for good. Some even awaken **exclusive arms**.',
      'Power has a price: erosion is a constant risk, and the Trelinton incident — where a Stellaris became a **Fallen Star** — still fuels tension inside Pax.',
    ],
  },
  {
    key: 'sanctuaries',
    title: 'Sanctuaries & Commanders',
    emoji: '🛰️',
    body: [
      'Guided by **Tarot: The Fool**, Pax launched the *Sanctuary Pivot*: pioneers carried projection cores into the Wildness and raised safe zones for refugees.',
      'Each Sanctuary runs on a **Sanctuary Core**, able to airdrop supplies and call in reinforcements — this bot is modelled on one.',
      'Holding a Sanctuary Core takes an unshakeable mind, so Pax screens its **Sanctuary Commanders** carefully. That means you, Commander.',
    ],
  },
  {
    key: 'factions',
    title: 'Factions & counters',
    emoji: '🔁',
    body: [
      'Every Stellaris belongs to one of five factions. Four of them form a counter loop:',
      '🔥 **Inferno** ▸ ☣️ **Rancor** ▸ ⚡ **Flare** ▸ 🌑 **Void** ▸ 🔥 **Inferno**',
      'Countering an enemy grants the advantage; facing your own counter is a disadvantage. 🌌 **Nebula** sits outside the loop — no advantage, no weakness.',
      'Pledge a faction with `/faction` — the same loop powers Calamity Breaches, expeditions and duels in this server.',
    ],
  },
  {
    key: 'classes',
    title: 'Classes & squads',
    emoji: '🧩',
    body: [
      '⚔️ **Assaulter** — physical damage dealers.\n💥 **Devastator** — energy damage dealers.\n🛡️ **Defender** — frontline tanks who taunt and shield.\n🩹 **Support** — healers and buff/debuff specialists.',
      'Battles field five Stellaris, so squad synergy and faction matchups decide most fights.',
    ],
  },
  {
    key: 'echo',
    title: 'Echo summons & rarity',
    emoji: '🎴',
    body: [
      'New Stellaris are recruited through **Echo** summons using Echo Permits or Diamonds.',
      'Rarity climbs from R and SR through SSR and SSR+ up to the UR tiers, while **Mimic** variants bring alternate takes on familiar Stellaris.',
      'The famous launch promise: **10 free summons a day for a year — 3,650 in total.**',
    ],
  },
  {
    key: 'companions',
    title: 'Mechmon, Mechas & Artifacts',
    emoji: '🤖',
    body: [
      '**Mechmon** are cyber pets that fight alongside your squad; Mechas, Artifacts and equipment (arms, gloves, helmet, suit) round out your Combat Power.',
      'Idle progress keeps paying out while you are away — collect your AFK rewards regularly.',
    ],
  },
  {
    key: 'noah',
    title: 'Noah Industries & allies',
    emoji: '🚢',
    body: [
      'Many Stellaris work with **Noah Industries**, which operates a ship with engineering, intelligence, field-operations, logistics and medical teams.',
      'Names you will hear around the Sanctuary: the Crimson Tide Front, Meteoris Biotech, the Starlight Council, the Sakura Alliance, the Solar Scripture, the Sacred Union, Iris-9 and Azure Express.',
    ],
  },
  {
    key: 'codes',
    title: 'Redeeming gift codes',
    emoji: '🎟️',
    body: [
      'In game: tap your **avatar** (top-left) → **System Settings** → type the code into the redeem box → **Redeem**.',
      'Rewards land in your inventory or mailbox. Codes are not case-sensitive and they expire — staff keep the live list in `/codes`.',
    ],
  },
];

/** Stellaris names for profile autocomplete (names only). */
export const STELLARIS = [
  'Alice', 'Alpha', 'Amber', 'Anatasia', 'Angel', 'Askar', 'Asuka', 'Athena', 'Aurora', 'Carol', 'Celice', 'Charlotte',
  'Charmilles', 'Cordelia', 'Cristina', 'Edie', 'Elaine', 'Eliana', 'Elisa', 'Evelyn', 'Flora', 'Freesia', 'Heather',
  'Herkina', 'Hilda', 'Illya', 'Jessica', 'Katia', 'Katie', 'Laya', 'Lecori', 'Leila', 'Lilyer', 'Lira', 'Loree', 'Mia',
  'Miria', 'Misha', 'Muir', 'Murane', 'Naland', 'Natalia', 'Pricia', 'Qi', 'Rita', 'Sefa', 'Selena', 'Selis', 'Sharon',
  'Simone', 'Solissa', 'Somis', 'Susan', 'Tina', 'Tsubaki', 'Veronica', 'Vinessa', 'Yelena',
];

/** Built-in trivia ("Signal Decryption"). `correct` indexes into `answers`. */
export const TRIVIA = [
  { q: 'What is the walled city-state at the heart of humanity\'s resistance called?', answers: ['Pax', 'Trelinton', 'Iris-9', 'Azure'], correct: 0 },
  { q: 'What forms when a Calamity Core fuses with surrounding matter?', answers: ['A Mechmon', 'A Calamity Mech', 'A Fallen Star', 'A Sanctuary'], correct: 1 },
  { q: 'Which faction does 🔥 Inferno counter?', answers: ['Void', 'Flare', 'Rancor', 'Nebula'], correct: 2 },
  { q: 'Which faction counters 🔥 Inferno?', answers: ['Void', 'Rancor', 'Nebula', 'Flare'], correct: 0 },
  { q: 'Which faction does ⚡ Flare counter?', answers: ['Inferno', 'Void', 'Rancor', 'Nebula'], correct: 1 },
  { q: 'Which faction does ☣️ Rancor counter?', answers: ['Flare', 'Void', 'Inferno', 'Nebula'], correct: 0 },
  { q: 'Which faction has no counter advantage or weakness?', answers: ['Void', 'Flare', 'Nebula', 'Rancor'], correct: 2 },
  { q: 'What is the land beyond Pax\'s three walls called?', answers: ['The Outlands', 'The Wildness', 'The Deadzone', 'The Rift'], correct: 1 },
  { q: 'What powers a Sanctuary and lets it airdrop supplies?', answers: ['A Stellar Core', 'Purifier Metal', 'A Sanctuary Core', 'An Echo Permit'], correct: 2 },
  { q: 'What is the in-game summoning system called?', answers: ['Echo', 'Pulse', 'Resonance', 'Signal'], correct: 0 },
  { q: 'Which class is the squad\'s tank?', answers: ['Assaulter', 'Devastator', 'Support', 'Defender'], correct: 3 },
  { q: 'Which class specialises in energy damage?', answers: ['Devastator', 'Assaulter', 'Defender', 'Support'], correct: 0 },
  { q: 'Which class deals physical damage?', answers: ['Support', 'Assaulter', 'Devastator', 'Defender'], correct: 1 },
  { q: 'What are the cyber pets that fight beside your Stellaris called?', answers: ['Mechlings', 'Mechmon', 'Corebots', 'Drones'], correct: 1 },
  { q: 'How many free summons a day made up the launch "3650" promise?', answers: ['5', '10', '20', '50'], correct: 1 },
  { q: 'Which substance discovered in Pax can neutralise disaster-machines?', answers: ['Purifier Metal', 'Stellar Dust', 'Echo Crystal', 'Ion Alloy'], correct: 0 },
  { q: 'How many Stellaris fight in a standard battle squad?', answers: ['3', '4', '5', '6'], correct: 2 },
  { q: 'Which organisation runs a ship and works with many Stellaris?', answers: ['Meteoris Biotech', 'Noah Industries', 'Azure Express', 'Crimson Tide Front'], correct: 1 },
  { q: 'What is a Stellaris who turns destructive, as in the Trelinton incident, called?', answers: ['A Fallen Star', 'A Ruin Knight', 'A Hollow', 'A Black Comet'], correct: 0 },
  { q: 'Under whose guidance was the "Sanctuary Pivot" launched?', answers: ['Tarot: The Magician', 'Tarot: The Star', 'Tarot: The Fool', 'Tarot: The Emperor'], correct: 2 },
  { q: 'How many commanders led humanity\'s counteroffensive before Pax was founded?', answers: ['Seven', 'Twelve', 'Twenty-two', 'Forty'], correct: 2 },
  { q: 'Tsubaki represents which group at Noah Industries?', answers: ['Sakura Alliance', 'Solar Scripture', 'Sacred Union', 'Starlight Council'], correct: 0 },
  { q: 'What is the name of Natalia\'s custom all-terrain vehicle?', answers: ['Pelican', 'Flamingo', 'Heron', 'Albatross'], correct: 1 },
  { q: 'Before Noah Industries, Lira was a researcher at…', answers: ['Azure Express', 'Iris-9', 'Meteoris Biotech', 'Crimson Tide Front'], correct: 2 },
  { q: 'Athena was a warrior of which order?', answers: ['Solar Scripture', 'Sacred Union', 'Starlight Council', 'Sakura Alliance'], correct: 0 },
  { q: 'Vinessa is a former member of which council?', answers: ['Iris Council', 'Starlight Council', 'Wall Council', 'Core Council'], correct: 1 },
  { q: 'Murane is a knight of which order?', answers: ['Crimson Tide Front', 'Sacred Union', 'Solar Scripture', 'Sakura Alliance'], correct: 1 },
  { q: 'Selis once worked as a mercenary for which group?', answers: ['Crimson Tide Front', 'Meteoris Biotech', 'Azure Express', 'Iris-9'], correct: 0 },
  { q: 'What gives Stellari the ability to permanently end a Mech?', answers: ['Destroying its Calamity Core', 'Freezing it', 'Purifier Metal armour', 'Echo summons'], correct: 0 },
  { q: 'Which in-game items are used for Echo summons?', answers: ['Ion Probes', 'Echo Permits', 'Stellar Medals', 'Gold'], correct: 1 },
];

/** Original Calamity Mech raid bosses for Calamity Breach events. */
export const BREACH_MECHS = [
  { name: 'Ashmaw Behemoth', element: 'inferno', flavor: 'A Calamity Core swallowed a collapsed foundry and woke up hungry.' },
  { name: 'Cinderhusk Devourer', element: 'inferno', flavor: 'Its armour still glows from the refinery it consumed.' },
  { name: 'Blightcoil Crawler', element: 'rancor', flavor: 'It drips corrosive slag across the outer patrol routes.' },
  { name: 'Rustvenom Hydra', element: 'rancor', flavor: 'Three heads, one core — and every bite corrodes steel.' },
  { name: 'Stormglass Colossus', element: 'flare', flavor: 'Lightning arcs between the shattered skyscraper glass it wears.' },
  { name: 'Arcspine Warden', element: 'flare', flavor: 'A rail-yard Mech crackling with stolen current.' },
  { name: 'Hollowveil Leviathan', element: 'void', flavor: 'Sensors go dark wherever its shadow passes.' },
  { name: 'Nullshade Stalker', element: 'void', flavor: 'It hunts by swallowing light — and signal.' },
  { name: 'Starwrack Titan', element: 'nebula', flavor: 'An orbital wreck fused into a walking fortress.' },
  { name: 'Prismcore Sentinel', element: 'nebula', flavor: 'Its core refracts every attack thrown at it.' },
];

/** Expedition routes into the Wildness. */
export const EXPEDITION_ROUTES = {
  sweep: { key: 'sweep', name: 'Perimeter Sweep', emoji: '🛰️', hours: 1, shards: [25, 40], xp: [30, 50], relicChance: 0.12, tiers: { R: 90, SR: 10 }, ambush: 0, blurb: 'A quick loop of the Sanctuary fence line.' },
  salvage: { key: 'salvage', name: 'Ruins Salvage', emoji: '🏚️', hours: 4, shards: [70, 110], xp: [90, 140], relicChance: 0.35, tiers: { R: 65, SR: 30, SSR: 5 }, ambush: 0.08, blurb: 'Pick through Old Era ruins for anything usable.' },
  recon: { key: 'recon', name: 'Deep Wildness Recon', emoji: '🌋', hours: 8, shards: [120, 180], xp: [160, 240], relicChance: 0.6, tiers: { R: 40, SR: 40, SSR: 17, UR: 3 }, ambush: 0.15, blurb: 'Push into blockade zones where Calamity Mechs nest.' },
};

/** Collectible relics recovered on expeditions (original items). */
export const RELICS = [
  { key: 'projection_core', name: 'Cracked Projection Core', tier: 'R', emoji: '🔹' },
  { key: 'old_era_coin', name: 'Old Era Coin', tier: 'R', emoji: '🪙' },
  { key: 'ration_tin', name: 'Pax Ration Tin', tier: 'R', emoji: '🥫' },
  { key: 'wall_rivet', name: 'Rusted Wall Rivet', tier: 'R', emoji: '🔩' },
  { key: 'pioneer_map', name: 'Faded Pioneer Map', tier: 'R', emoji: '🗺️' },
  { key: 'ion_lantern', name: 'Ion Lantern Shell', tier: 'R', emoji: '🏮' },
  { key: 'purifier_shard', name: 'Purifier Shard', tier: 'SR', emoji: '🔷' },
  { key: 'beacon_fragment', name: 'Sanctuary Beacon Fragment', tier: 'SR', emoji: '📡' },
  { key: 'wildness_compass', name: 'Wildness Compass', tier: 'SR', emoji: '🧭' },
  { key: 'mechmon_tag', name: 'Lost Mechmon Tag', tier: 'SR', emoji: '🏷️' },
  { key: 'inert_core', name: 'Inert Calamity Core', tier: 'SSR', emoji: '🔮' },
  { key: 'fallen_star', name: 'Fallen Star Fragment', tier: 'SSR', emoji: '☄️' },
  { key: 'fools_card', name: 'The Fool\'s Card', tier: 'UR', emoji: '🃏' },
];
export const RELIC_TIER_COLORS = { R: '⬜', SR: '🟦', SSR: '🟪', UR: '🟨' };
export const RELIC_SALVAGE = { R: 15, SR: 45, SSR: 150, UR: 500 };
