// Ordered schema migrations. Never edit a shipped migration — append a new one instead.

export const MIGRATIONS = [
  /* 1 — initial schema */ `
  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE guild_settings (
    guild_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE guild_state (
    guild_id TEXT PRIMARY KEY,
    season_no INTEGER NOT NULL DEFAULT 1,
    season_key TEXT,
    season_started_at INTEGER,
    week_key INTEGER,
    surge_mult REAL,
    surge_until INTEGER,
    surge_by TEXT,
    drops_day INTEGER,
    drops_count INTEGER NOT NULL DEFAULT 0,
    last_drop_at INTEGER NOT NULL DEFAULT 0,
    breach_day INTEGER,
    data TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE members (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 0,
    season_xp INTEGER NOT NULL DEFAULT 0,
    weekly_xp INTEGER NOT NULL DEFAULT 0,
    shards INTEGER NOT NULL DEFAULT 0,
    shards_earned INTEGER NOT NULL DEFAULT 0,
    messages INTEGER NOT NULL DEFAULT 0,
    voice_minutes INTEGER NOT NULL DEFAULT 0,
    last_xp_at INTEGER NOT NULL DEFAULT 0,
    day_key INTEGER,
    day_chat_xp INTEGER NOT NULL DEFAULT 0,
    day_voice_xp INTEGER NOT NULL DEFAULT 0,
    day_chat_shards INTEGER NOT NULL DEFAULT 0,
    day_expeditions INTEGER NOT NULL DEFAULT 0,
    day_duels INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    last_daily_day INTEGER,
    daily_claims INTEGER NOT NULL DEFAULT 0,
    faction TEXT,
    faction_since INTEGER,
    title TEXT,
    accent INTEGER,
    bio TEXT,
    game_region TEXT,
    game_server TEXT,
    game_uid TEXT,
    uid_public INTEGER NOT NULL DEFAULT 0,
    main_stellaris TEXT,
    boost_mult REAL,
    boost_until INTEGER,
    levelup_ping INTEGER NOT NULL DEFAULT 1,
    stats TEXT NOT NULL DEFAULT '{}',
    onboarded INTEGER NOT NULL DEFAULT 0,
    left_guild INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  ) WITHOUT ROWID;
  CREATE INDEX idx_members_xp ON members (guild_id, xp DESC);
  CREATE INDEX idx_members_season ON members (guild_id, season_xp DESC);
  CREATE INDEX idx_members_weekly ON members (guild_id, weekly_xp DESC);
  CREATE INDEX idx_members_shards ON members (guild_id, shards DESC);

  CREATE TABLE ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'shards',
    delta INTEGER NOT NULL,
    balance INTEGER NOT NULL,
    kind TEXT NOT NULL,
    reason TEXT,
    actor_id TEXT,
    ref TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_ledger_member ON ledger (guild_id, user_id, id DESC);

  CREATE TABLE shop_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    emoji TEXT,
    price INTEGER NOT NULL,
    stock INTEGER,
    stock_period TEXT NOT NULL DEFAULT 'none',
    limit_count INTEGER,
    limit_period TEXT NOT NULL DEFAULT 'none',
    min_level INTEGER NOT NULL DEFAULT 0,
    role_id TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_shop_guild ON shop_items (guild_id, sort, id);

  CREATE TABLE purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'complete',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_purchases_item ON purchases (guild_id, item_id, created_at);
  CREATE INDEX idx_purchases_user ON purchases (guild_id, user_id, item_id, created_at);

  CREATE TABLE inventory (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    data TEXT,
    acquired_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, item_key)
  ) WITHOUT ROWID;

  CREATE TABLE requisitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    item_id INTEGER,
    purchase_id INTEGER,
    title TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    cost INTEGER NOT NULL DEFAULT 0,
    region TEXT,
    server TEXT,
    uid TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    staff_id TEXT,
    staff_note TEXT,
    channel_id TEXT,
    message_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_req_status ON requisitions (guild_id, status, id);
  CREATE INDEX idx_req_user ON requisitions (guild_id, user_id, id DESC);

  CREATE TABLE timed_roles (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, role_id)
  ) WITHOUT ROWID;

  CREATE TABLE quests (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    period TEXT NOT NULL,
    period_key INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    quest_key TEXT NOT NULL,
    target INTEGER NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    reward_shards INTEGER NOT NULL,
    reward_xp INTEGER NOT NULL,
    meta TEXT,
    completed_at INTEGER,
    claimed_at INTEGER,
    PRIMARY KEY (guild_id, user_id, period, period_key, slot)
  ) WITHOUT ROWID;

  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    channel_id TEXT,
    message_id TEXT,
    state TEXT NOT NULL DEFAULT '{}',
    started_by TEXT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_events_active ON events (guild_id, kind, status);

  CREATE TABLE event_participants (
    event_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    actions INTEGER NOT NULL DEFAULT 0,
    data TEXT,
    last_action_at INTEGER,
    PRIMARY KEY (event_id, user_id)
  ) WITHOUT ROWID;

  CREATE TABLE giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    host_id TEXT NOT NULL,
    prize TEXT NOT NULL,
    description TEXT,
    winners INTEGER NOT NULL,
    entry_cost INTEGER NOT NULL DEFAULT 0,
    min_level INTEGER NOT NULL DEFAULT 0,
    role_id TEXT,
    requires_uid INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    winner_ids TEXT NOT NULL DEFAULT '[]',
    ends_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_giveaways_status ON giveaways (guild_id, status);

  CREATE TABLE giveaway_entries (
    giveaway_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (giveaway_id, user_id)
  ) WITHOUT ROWID;

  CREATE TABLE expeditions (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    route TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  ) WITHOUT ROWID;

  CREATE TABLE duels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    challenger_id TEXT NOT NULL,
    opponent_id TEXT NOT NULL,
    stake INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    challenger_pick TEXT,
    opponent_pick TEXT,
    winner_id TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE faction_points (
    guild_id TEXT NOT NULL,
    week_key INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    faction TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, week_key, user_id)
  ) WITHOUT ROWID;

  CREATE TABLE faction_results (
    guild_id TEXT NOT NULL,
    week_key INTEGER NOT NULL,
    winner TEXT,
    standings TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, week_key)
  ) WITHOUT ROWID;

  CREATE TABLE trivia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    question TEXT NOT NULL,
    answers TEXT NOT NULL,
    correct INTEGER NOT NULL,
    created_by TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    code TEXT NOT NULL,
    rewards TEXT,
    region TEXT NOT NULL DEFAULT 'all',
    expires_at INTEGER,
    added_by TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE seasons (
    guild_id TEXT NOT NULL,
    season_no INTEGER NOT NULL,
    season_key TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    results TEXT,
    PRIMARY KEY (guild_id, season_no)
  ) WITHOUT ROWID;

  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    run_at INTEGER NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_jobs_due ON jobs (run_at);
  `,
];
