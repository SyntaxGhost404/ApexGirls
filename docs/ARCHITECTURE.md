# Architecture

Sanctuary Core talks to Discord directly: a Gateway v10 client for events and an HTTP API client for
everything else. The code is plain modern JavaScript (ES modules) on Node.js ≥ 22.13.

```
src/
├─ index.js              entry: env, logger, Bot, features, signal handling
├─ bot.js                composition root (REST, gateway, cache, router, DB, scheduler, services)
├─ config.js             .env parsing/validation
├─ core/                 Discord platform layer (no feature logic)
│  ├─ rest.js            HTTP client: per-route buckets via X-RateLimit-Bucket, global limiter,
│  │                     429/5xx retries, multipart uploads, readable DiscordAPIError
│  ├─ gateway.js         shards: HELLO/heartbeat (+zombie detection), IDENTIFY gate with session-start
│  │                     budget guard, RESUME (also across restarts), zlib-stream, send limiter, backoff
│  ├─ cache.js           minimal state: guilds, roles, channels, threads, voice states, own member,
│  │                     member LRU; snapshot/restore for cross-restart resumes
│  ├─ permissions.js     permission bits, base + overwrite computation, role-hierarchy checks
│  ├─ components.js      Components V2 / legacy builders + validator for documented limits
│  ├─ interactions.js    InteractionContext (reply/defer/update/modal/followup with ack-state
│  │                     tracking and an auto-defer safety net) + router
│  ├─ http.js            optional /health and Ed25519-verified /interactions endpoint
│  ├─ scheduler.js       persistent jobs (SQLite, at-least-once) + guarded intervals
│  └─ api.js             helpers: send/edit/delete, DM with graceful fallback, roles, members
├─ db/                   node:sqlite wrapper (statement cache, nested tx via savepoints) + migrations
├─ services/             settings (defaults deep-merged with overrides), guild state, members,
│                        economy ledger, staff audit log, application emoji registry
├─ content/              theme (palette, ranks, factions), lore & trivia, defaults & quest pool
├─ features/             one module per feature; each registers commands, components, modals,
│                        gateway listeners, activity listeners and scheduler jobs
└─ ui.js                 themed building blocks (notices, headings, banner)
```

## Event flow

```
Gateway ──dispatch──► Cache.handle() ──► INTERACTION_CREATE ─► InteractionRouter ─► feature handler
                                    └─► bot.on('MESSAGE_CREATE' | 'VOICE_STATE_UPDATE' | …) listeners
feature ──bot.activity({ type, guildId, userId, … })──► quests · factions · drops (decoupled)
```

- **Activity bus.** Leveling emits `message`, `reply`, `xp`, `voice`, `levelup`; other features emit
  `daily`, `event`, `trivia`, `expedition`, `duel_win`, `purchase`, `reaction`. Directives and factions only
  listen — features never import each other's internals.
- **Interactions** carry their state in `custom_id` (`prefix:action:args…`, ≤100 chars). Public panels
  encode their owner; other members who click get their own ephemeral copy instead of hijacking it.
- **Acknowledgement.** Every handler gets ≤2.3 s before the router defers automatically (update-defer for
  components, ephemeral defer for commands). `reply()`/`update()` transparently turn into edits or
  followups depending on the state, so handlers never double-acknowledge.

## Reliability

- **Identify budget:** Discord resets the token after 1,000 identifies in 24 h. The gateway checks
  `session_start_limit` and waits for the reset when fewer than 4 remain. On `SIGTERM` the session id,
  sequence and a cache snapshot are saved; a restart within ~150 s sends RESUME instead of IDENTIFY.
- **Privileged intents:** a `4014` close falls back to non-privileged intents once (the bot keeps working
  with cooldown-only anti-spam) instead of crash-looping.
- **Rate limits:** buckets are learned from response headers, shared buckets are merged, the global limit
  is enforced client-side (interaction endpoints exempt), and access errors abort batch jobs early to stay
  far from Cloudflare's invalid-request limit.
- **Money safety:** every balance change runs inside a SQLite transaction and writes a ledger row (except
  high-frequency chat/voice trickles). Purchases check level, ownership, per-member limits, stock windows and
  funds atomically; failed deliveries (e.g. a role that can't be assigned) refund automatically.
- **Jobs** (event ends, giveaway draws, duel expiry, timed roles) are persisted and idempotent; period
  rollovers compare stored keys every minute, so a rollover missed during downtime runs on the next start.

## Data model (SQLite)

`members` (progression, wallet, profile, daily counters, stats JSON) · `ledger` · `guild_settings` (JSON
overrides) · `guild_state` (season/week keys, surge, drop counters) · `shop_items` · `purchases` · `inventory`
· `requisitions` · `timed_roles` · `quests` · `events` + `event_participants` · `giveaways` + `giveaway_entries`
· `expeditions` · `duels` · `faction_points` + `faction_results` · `trivia` · `codes` · `seasons` · `jobs` · `kv`.

Migrations live in `src/db/schema.js` and are applied in order using `PRAGMA user_version`. Append new
migrations; never edit shipped ones.

## Adding a feature

```js
// src/features/example.js
export default function setup(bot) {
  bot.router.command({ name: 'example', description: 'Example', async run(ctx) {
    await ctx.reply(v2([container({ accent: COLORS.primary }, text('Hello, Commander'))], { ephemeral: true }));
  } });
  bot.router.component('ex', async (ctx, action, arg) => { /* custom_id "ex:action:arg" */ });
  bot.onActivity((evt) => { /* react to activity */ });
}
```

Register it in `src/features/index.js`, add a flow test in `tests/flows.test.js`, and run
`npm run check-payloads -- <channel>` to let Discord validate the new payloads.
