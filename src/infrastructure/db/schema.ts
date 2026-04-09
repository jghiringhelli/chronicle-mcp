/**
 * SQLite schema for Chronicle.
 */

export const SCHEMA_SQL: string = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'buffer',
  weight REAL NOT NULL DEFAULT 0.5,
  decay_rate REAL NOT NULL DEFAULT 0.1,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  project TEXT,
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  embedding BLOB,
  confirmed INTEGER NOT NULL DEFAULT 0,
  fact_subject TEXT,
  fact_predicate TEXT,
  device_id TEXT,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  device TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  active_tasks TEXT NOT NULL DEFAULT '[]',
  pending_decisions TEXT NOT NULL DEFAULT '[]',
  touched_files TEXT NOT NULL DEFAULT '[]',
  summary TEXT
);

CREATE TABLE IF NOT EXISTS triggers (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  action TEXT NOT NULL,
  content TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS preferences (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  context TEXT,
  strength TEXT NOT NULL DEFAULT 'mild',
  project TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(key, project)
);

CREATE TABLE IF NOT EXISTS solutions (
  id TEXT PRIMARY KEY,
  problem TEXT NOT NULL,
  solution TEXT NOT NULL,
  language TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  source_project TEXT,
  source_file TEXT,
  created_at TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  insight_type TEXT NOT NULL,
  project TEXT,
  content TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_count INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(insight_type, project)
);

CREATE TABLE IF NOT EXISTS sync_cursor (
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_push_at TEXT,
  last_pull_at TEXT,
  memories_version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
CREATE INDEX IF NOT EXISTS idx_memories_weight ON memories(weight DESC);
CREATE INDEX IF NOT EXISTS idx_triggers_action ON triggers(action);

-- ─────────────────────────────────────────────────────────────────────────────
-- Team cache  (local mirror of Railway team tables — populated by team sync)
-- All team features are no-op when teamId is not configured.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_shared_cache (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  team_id        TEXT NOT NULL,
  project        TEXT,
  content        TEXT NOT NULL,
  memory_type    TEXT NOT NULL,
  tags           TEXT NOT NULL DEFAULT '[]',
  category       TEXT,
  shared_at      TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_insights_cache (
  id             TEXT PRIMARY KEY,
  team_id        TEXT NOT NULL,
  project        TEXT,
  insight_type   TEXT NOT NULL,
  content        TEXT NOT NULL,
  confidence     REAL NOT NULL DEFAULT 0.5,
  source_count   INTEGER NOT NULL DEFAULT 1,
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_patterns_cache (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  team_id        TEXT NOT NULL,
  project        TEXT,
  pattern_type   TEXT NOT NULL,
  metric         TEXT NOT NULL,
  value          REAL NOT NULL,
  period         TEXT NOT NULL DEFAULT 'monthly',
  computed_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_log_buffer (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  team_id        TEXT NOT NULL,
  project        TEXT,
  pattern        TEXT NOT NULL,
  outcome        TEXT NOT NULL DEFAULT 'neutral',
  category       TEXT NOT NULL DEFAULT 'general',
  tags           TEXT NOT NULL DEFAULT '[]',
  share_content  INTEGER NOT NULL DEFAULT 0,
  raw_content    TEXT,
  logged_at      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS team_sync_cursor (
  user_id        TEXT NOT NULL,
  team_id        TEXT NOT NULL,
  last_pull_at   TEXT,
  PRIMARY KEY (user_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_team_shared_cache_team    ON team_shared_cache(team_id);
CREATE INDEX IF NOT EXISTS idx_team_shared_cache_project ON team_shared_cache(team_id, project);
CREATE INDEX IF NOT EXISTS idx_team_insights_cache_team  ON team_insights_cache(team_id);
CREATE INDEX IF NOT EXISTS idx_prompt_log_buffer_status  ON prompt_log_buffer(status);
`;
