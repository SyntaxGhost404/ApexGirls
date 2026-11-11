# Staff guide — Sanctuary Core

Everything is configured from Discord. No restarts, no code changes.

- **`/setup`** — control panel (needs *Manage Server*). Pick a section from the menu at the bottom.
- **`/staff …`** — day-to-day tools (Manage Server, or roles listed under *Setup → Roles & rewards → Staff roles*
  if your admins also allow those roles under *Server Settings → Integrations → Sanctuary Core*).
- **`/giveaway …`** — staff and *Event host* roles.

---

## First-time setup (10 minutes)

1. **`/setup` → Overview & health** shows what is missing. Green = good, red = action needed.
2. **Channels**
   - *Level-up announcements* — optional; used for the "channel" mode and for voice level-ups.
   - *Events & results* — breaches, faction results and season podiums are posted here.
   - *Requisition queue* — **staff-only** channel where in-game reward tickets appear.
   - *Staff audit log* — **staff-only**; every adjustment, purchase, giveaway and setting change.
   - *Welcome cards* — where new members are greeted (enable under *Community modules*).
3. **Roles & rewards**
   - *Staff roles* and *Event host roles*.
   - *Level reward roles*, e.g. Lv 5 Pioneer, Lv 10 Scout, Lv 20 Sanctuary Guard, Lv 40 Sanctuary Commander,
     Lv 65 Stellar Vanguard. The bot's own role must sit **above** these roles.
   - *Faction roles* (optional) — coloured roles for 🔥 Inferno, ☣️ Rancor, ⚡ Flare, 🌑 Void, 🌌 Nebula.
4. **Leveling → Multipliers & exclusions** — block XP in spam/bot/meme channels, boost event channels.
5. **Events → Drop channels** — the chat channels where Supply Drops may appear.
6. **Supply Depot** — review the starter catalogue. In-game reward items start **hidden**; put them on sale
   once your team is ready to fulfil requisitions.
7. **Economy → Branding** — currency name/emoji, the daily reset hour (UTC) and an optional banner
   image URL (use official art you have the rights to).

---

## How progression works (default numbers)

| Source | Default | Notes |
| --- | --- | --- |
| Chat | 15–25 XP + 2 shards per XP-earning message | 1 per 60 s; +20% when replying or in an active conversation; quality-gated |
| Daily chat caps | soft 1,500 XP (½ after) · hard 3,000 XP · 120 shards | keeps grinding in check |
| Voice | 5 XP/min · 3 shards per 10 min · 600 XP/day | ≥2 people in channel; muted/deafened earn nothing |
| Level-up | 20 + 5 × level shards | e.g. level 10 → 70 shards |
| Supply Airdrop | 100 + 10/streak day (max +150) | +250 every 7 days, +1,000 every 30 days |
| Directives | ~60–160 per daily, ~300–550 per weekly | +150 for clearing all dailies |
| Faction Clash | 200 shards to winning faction members with ≥150 pts | each member contributes ≤2,500 pts/week |
| Calamity Breach | 3,000-shard pool shared by contribution | ×2 when elite; 40% if the Mech retreats |
| Supply Drop | 40–120 shards × 5 claimers | ≤6/day, ≥45 min apart, only in busy drop channels |
| Trivia | 120 first · 40 next two | one guess each |
| Expeditions | 25–180 shards + relics | 3 launches/day |
| Season prizes | 3,000 / 2,000 / 1,500 / 750 / 750 / 500 ×5 | paid automatically on the 1st of each month |

XP needed for the next level is `5·L² + 50·L + 100` (level 10 → 1,100 XP), scalable in *Setup → Leveling →
Daily limits & XP curve*. Lifetime levels never reset; **season XP** resets monthly and **weekly XP** every Monday.

**Balance tips**
- Raising rewards is easy; taking them back is not. Change one number at a time and watch the ladders for a week.
- Keep prices for in-game rewards high and use per-member limits *and* stock windows (e.g. 1 per month, 20 in stock).
- Use **Resonance Surge** (×1.5 for 1–2 h) for celebrations instead of permanent multipliers.

---

## Daily operations

### Requisitions (in-game rewards)
Members who buy an in-game reward (or win a giveaway / season prize marked as in-game) enter their game
version, server and UID. A ticket appears in the requisition queue channel:

- **✅ Mark fulfilled** — after sending the reward in game. The member gets a DM.
- **❌ Reject & refund** — enter a reason (sent to the member). Shards are refunded automatically.

`/staff requisitions` lists everything pending with links to the tickets. Members can cancel their own
pending Depot requisitions (refunded) from `/inventory → Requisitions`.

### Events
`/staff event type:<…> [channel] [elite] [percent] [minutes]`
- **Calamity Breach** — raid boss sized to recent activity. `elite:true` doubles HP and rewards.
- **Supply Drop** — instant crate in the chosen channel.
- **Signal Decryption** — trivia from the built-in Apex Girls lore bank plus your custom questions
  (`/staff trivia` → *Add question*; the first answer you type is the correct one — answers are shuffled).
- **Resonance Surge** — `percent:150 minutes:60` for ×1.5 XP for an hour.

Automatic breaches (one per day in a time window) and automatic drops are configured in *Setup → Events*.

### Giveaways
`/giveaway start [channel] [required_role] [entry_cost] [in_game_prize]` opens a form (prize, winners,
duration such as `2h` or `3d`, minimum level, description). `/giveaway list` → *End now*, *Reroll 1*,
*Cancel & refund*. With `in_game_prize:true`, winners claim through a DM button (or `/giveaway claim`), which
files a requisition for your team.

### Gift codes
`/staff codes` → *Add code* (code, rewards, expiry like `7d`, game version). Members see live codes with
`/codes`, including the redeem steps. *Post board here* publishes the list in the current channel.

### Member records
`/staff inspect member` shows totals, recent ledger entries and quick actions: adjust shards/XP, re-sync
level roles, reset progress (keeps wallet and inventory). `/staff adjust` does the same from the command line.
Every change is written to the ledger and the audit log channel.

### Seasons
Seasons end automatically on the 1st of each month (at the reset hour): prizes are paid to the top 10, a
podium is posted in the events channel and season XP resets. `/staff season` shows the standings and can
end a season early.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Level reward / faction / Depot role not granted | `/setup → Overview`: give the bot **Manage Roles** and move its role above the reward roles. Then `/staff inspect` → *Sync level roles*. |
| No level-up messages | Check *Leveling → Level-up rewards & messages* (mode, "announce from level") and that the bot can post in the channel. |
| No XP in a channel | It may be blocked under *Multipliers & exclusions* (also applies to threads and channels inside a blocked category). |
| "Message Content intent off" in Overview | Enable it in the Developer Portal → Bot. Until then only cooldown-based anti-spam applies. |
| Welcome cards never appear | Enable the *Server Members* intent and the welcome module, and set the welcome channel. |
| Requisition tickets missing | Set the *Requisition queue* channel and let the bot post embeds there. |
