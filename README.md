# Sanctuary Core

The community, leveling and engagement bot for the official **Apex Girls: 3650-Pull Giveaway** /
**Scarlet Girls - Elite Edition** Discord server.

In the game's lore, a *Sanctuary Core* powers each Sanctuary beyond Pax's walls — it airdrops
supplies and calls in reinforcements. This bot is that terminal for the server: it tracks real
participation, pays out **Core Shards**, runs community events and gives staff a full control panel.

Built **directly on the Discord API** (Gateway v10 + HTTP API) — no discord.js, Eris or any other
Discord wrapper. Runtime dependencies: [`ws`](https://github.com/websockets/ws) (WebSocket transport)
and, optionally, `https-proxy-agent` for hosts behind an HTTP proxy. Storage is the SQLite engine
built into Node.js (`node:sqlite`), so there is nothing native to compile.

---

## Feature tour

| Area | What members get | Command |
| --- | --- | --- |
| **Commander ID card** | Rank, level, XP bar, season/lifetime position, wallet, streak, badges, game version/server/UID, main Stellaris, bio | `/profile`, right-click → *Apps → View Commander ID* |
| **Leveling** | XP for genuine conversation (quality-gated, 1 XP message/min), reply & active-chat bonus, voice XP with company, 11 lore ranks from *Drifter* to *Apex Commander*, level-reward roles | automatic |
| **Ladders** | Season (monthly prizes), lifetime, weekly, wealth, voice, streak | `/leaderboard` |
| **Supply Airdrop** | Daily claim, escalating streak bonus, 7/30-day caches, Streak Shields | `/daily` |
| **Directives** | 3 daily + 3 weekly quests per member (stable, seeded), claim buttons, all-clear bonus, auto-claim after reset | `/quests` |
| **Supply Depot** | Titles, card accents, Discord roles (permanent or timed), Streak Shields, XP boosters, staff-fulfilled in-game rewards with purchase limits & stock windows | `/shop`, `/inventory` |
| **Requisitions** | In-game rewards (shop, giveaways, season prizes) become staff tickets; members get DMs on fulfil/reject; rejects refund automatically | `/inventory` → Requisitions |
| **Faction Clash** | Pledge to 🔥 Inferno, ☣️ Rancor, ⚡ Flare, 🌑 Void or 🌌 Nebula; XP earns capped weekly faction points; winners rewarded; optional faction roles | `/faction` |
| **Calamity Breach** | Raid boss with Assault / Devastate / Support actions, faction counter bonus (+50%), rally stacks, contribution-based rewards, MVP | staff `/staff event` or daily auto |
| **Supply Drops** | First-come crates that spawn only in lively conversations (≥3 chatters), anti-alt checks | automatic / staff |
| **Signal Decryption** | Apex Girls lore trivia (30 built-in + custom questions), first correct answers win | staff `/staff event` |
| **Resonance Surge** | Temporary server-wide XP multiplier | staff `/staff event` |
| **Giveaways** | One-click entry, level/role requirements, optional shard entry fee, crypto-random winners, reroll, UID claim for in-game prizes | `/giveaway start` |
| **Expeditions** | 1h/4h/8h idle runs into the Wildness, daily hazard faction, ambush risk, 13 collectible relics, duplicate salvage | `/expedition` |
| **Duels** | Secret faction pick, counter loop decides, escrowed stakes, draws refund, small "Sanctuary tax" sink | `/duel` |
| **Knowledge** | Field manual, lore archive (Pax, Calamity Mechs, Stellari, factions, classes, Echo…), gift-code board with redeem steps | `/help`, `/archive`, `/codes` |
| **Onboarding** | Optional 4-step briefing (+100 shards once), welcome cards with burst protection | `/help` → *Start briefing* |

**Staff:** `/setup` (control panel for every number, channel and role — no restart, no code), `/staff`
(adjust, inspect, requisition queue, events, codes, trivia, seasons) and `/giveaway`.
See **[docs/STAFF_GUIDE.md](docs/STAFF_GUIDE.md)**.

### Designed against spam

- One XP-earning message per member per cooldown (default 60 s).
- Messages are analysed: too short (CJK counts double, so Japanese/Korean players are not penalised),
  repeated characters/words, copy-paste and near-duplicates of the last 3 messages earn nothing.
- Daily soft cap (XP halved) and hard cap (no chat XP) — grinding has diminishing returns.
- Voice XP needs at least two people in the channel and no self-deafen (and by default no mute).
- Directives count only XP-earning messages; reply/reaction directives count *distinct* targets.
- Supply crates need a Discord account older than 7 days and level ≥ 1.
- No member-to-member transfers; duel stakes are capped and taxed.

### Components V2 and classic embeds, each where it fits

- **Components V2** (containers, sections with thumbnails/buttons, text displays, separators,
  media galleries) for every member-facing interactive surface: ID cards, ladders, Depot, Directives,
  events, giveaways, the setup panel.
- **Classic embeds** for records that benefit from fields and timestamps: the staff audit log,
  requisition tickets and DM notifications.
- **Modals** use the current Label component with text inputs, **radio groups** (game version, enums),
  **checkbox groups/checkboxes** (feature toggles) and **role/channel selects** inside modals.
- Every payload is validated against Discord's documented limits in tests, and `npm run check-payloads`
  posts all of them to a channel to have Discord itself confirm they are accepted.

---

## Quick start

Requirements: **Node.js 22.13+** (Node 24 LTS recommended).

```bash
git clone https://github.com/SyntaxGhost404/ApexGirls.git
cd ApexGirls
npm ci            # or: npm install
cp .env.example .env
# edit .env → DISCORD_TOKEN=...
npm start
```

On first start the bot registers its slash commands (only when the command list changed) and
connects to the Gateway. Then, in Discord, a member with **Manage Server** runs **`/setup`**.

### Discord Developer Portal checklist

1. **Bot → Privileged Gateway Intents:** enable **Message Content** (anti-spam text analysis) and
   **Server Members** (welcome cards, leaver tracking). If either is missing the bot keeps running
   in a reduced mode and tells you so in `/setup → Overview`.
2. **General Information → Interactions Endpoint URL:** leave **empty** when the bot runs normally
   (interactions arrive over the Gateway). See *HTTP interactions* below for the alternative.
3. **Invite the bot** with the permissions it needs (View Channels, Send Messages, Send Messages in
   Threads, Embed Links, Attach Files, Read Message History, Use External Emojis, Manage Roles):

   `https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=275146722304`

   Then drag the bot's role **above** every role it should hand out (level rewards, faction roles,
   Depot roles). Tip: set the same scopes/permissions under *Installation → Default Install Settings*
   so the in-app "Add App" button installs the bot user too.

### Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | **Required.** Bot token. |
| `DISCORD_APPLICATION_ID` | from token | Application id. |
| `DATABASE_PATH` | `./data/sanctuary.db` | SQLite file (back it up!). |
| `COMMAND_SCOPE` | `global` | `global`, or `guild` for instant dev updates (with `DEV_GUILD_ID`). |
| `SYNC_COMMANDS` | `true` | Push the command list on start when it changed. |
| `ENABLE_MESSAGE_CONTENT` | `true` | Request the Message Content intent. |
| `ENABLE_GUILD_MEMBERS` | `true` | Request the Server Members intent. |
| `GATEWAY_COMPRESSION` | `true` | zlib-stream transport compression. |
| `HTTP_PORT` / `HTTP_HOST` | off / `0.0.0.0` | Health check (`GET /health`) and optional HTTP interactions. |
| `DISCORD_PUBLIC_KEY` | — | Needed only for HTTP interactions (Ed25519 verification). |
| `LOG_LEVEL` / `LOG_FORMAT` | `info` / `pretty` | `debug` also validates every outgoing payload. `json` for log shippers. |

Behind an HTTP proxy, set `HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21).

### Running in production

- **systemd / pm2:** run `npm start`. The process exits cleanly on `SIGINT`/`SIGTERM`; a restart within
  ~2 minutes **resumes** the Gateway session (no re-identify, no missed events), which also protects the
  1,000-identifies-per-day budget.
- **Docker:** `docker build -t sanctuary-core . && docker run -d --env-file .env -v sanctuary-data:/app/data sanctuary-core`
- **Backups:** copy `data/sanctuary.db` (and `-wal`/`-shm` while running), or use `sqlite3 .backup`.
- **Health:** set `HTTP_PORT=8080` and point an uptime monitor at `GET /health`.

### HTTP interactions (optional)

The bot always needs the Gateway (chat and voice activity can only be observed there), but
interactions can also be delivered over HTTPS. Set `HTTP_PORT` and `DISCORD_PUBLIC_KEY`, expose the
port through HTTPS (reverse proxy / tunnel), and put `https://your-host/interactions` in the Developer
Portal. Requests are verified with Ed25519 and handled by the same router.

---

## Commands

| Command | Who |
| --- | --- |
| `/profile [member] [private]` · ☰ *View Commander ID* | everyone |
| `/leaderboard [ladder]` | everyone |
| `/daily` · `/quests` | everyone |
| `/shop` · `/inventory` | everyone |
| `/faction` · `/expedition` · `/duel <opponent> [stake]` | everyone |
| `/help [topic]` · `/archive [topic]` · `/codes` | everyone |
| `/giveaway start · list · claim` | hosts & staff (claim: winners) |
| `/staff adjust · inspect · requisitions · event · codes · trivia · season` | staff (Manage Server by default) |
| `/setup` | Manage Server |

---

## Development

```bash
npm test                 # unit + end-to-end interaction flow tests (no Discord connection)
npm run dev              # restart on file changes
npm run deploy-commands  # register commands (add -- --guild <id> for a dev guild)
npm run check-payloads -- <channel-id>   # live payload validation (posts & deletes test messages)
```

Architecture notes: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Content & IP note

Apex Girls, Scarlet Girls, their characters and lore belong to Neorigin Games / Nova Gaming. This bot
is built for the official community server: it references game names, factions, classes and character
names in text and contains **original** lore summaries, trivia wording, Calamity Mech names, relics and
rank titles. It ships **no game art, music or other assets**; staff can add official artwork through the
banner setting in `/setup` when they hold the rights to use it.
