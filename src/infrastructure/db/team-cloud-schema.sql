-- Chronicle Team Cloud Schema (Railway PostgreSQL)
--
-- SEPARATE from the individual schema. Individual tables (users, memories,
-- insights, session_summaries, sync_cursor) are NOT modified.
--
-- All team data lives here. Individual data stays individual.
-- Nothing in this file references individual tables except team_members.user_id,
-- which mirrors users.id as a soft reference (no FK to keep schemas decoupled).

-- ─────────────────────────────────────────────────────────────────────────────
-- Teams
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          TEXT        PRIMARY KEY,   -- slug, e.g. "pragmaworks"
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Team membership
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  user_id     TEXT        NOT NULL,      -- mirrors users.id (soft ref)
  team_id     TEXT        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'member',   -- 'member' | 'lead'
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Team-shared memories
-- Memories a user explicitly pushed to the team pool.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_shared_memories (
  id           TEXT        PRIMARY KEY,
  user_id      TEXT        NOT NULL,
  team_id      TEXT        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project      TEXT,
  content      TEXT        NOT NULL,
  memory_type  TEXT        NOT NULL,
  tags         TEXT[]      NOT NULL DEFAULT '{}',
  category     TEXT,
  shared_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsm_team    ON team_shared_memories(team_id);
CREATE INDEX IF NOT EXISTS idx_tsm_project ON team_shared_memories(team_id, project);
CREATE INDEX IF NOT EXISTS idx_tsm_user    ON team_shared_memories(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Prompt logs (opt-in)
-- Stores prompt patterns, not raw content unless share_content = TRUE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prompt_logs (
  id            TEXT        PRIMARY KEY,
  user_id       TEXT        NOT NULL,
  team_id       TEXT        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project       TEXT,
  pattern       TEXT        NOT NULL,    -- what the prompt was trying to do
  outcome       TEXT        NOT NULL DEFAULT 'neutral',  -- 'good'|'bad'|'neutral'
  category      TEXT        NOT NULL DEFAULT 'general',  -- 'debugging'|'refactoring'|etc.
  tags          TEXT[]      NOT NULL DEFAULT '{}',
  share_content BOOLEAN     NOT NULL DEFAULT FALSE,
  raw_content   TEXT,                    -- only populated when share_content = TRUE
  logged_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_logs_team    ON prompt_logs(team_id);
CREATE INDEX IF NOT EXISTS idx_prompt_logs_user    ON prompt_logs(user_id, team_id);
CREATE INDEX IF NOT EXISTS idx_prompt_logs_project ON prompt_logs(team_id, project);
CREATE INDEX IF NOT EXISTS idx_prompt_logs_outcome ON prompt_logs(team_id, outcome);

-- ─────────────────────────────────────────────────────────────────────────────
-- Team insights
-- Synthesized team-level patterns and practices.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_insights (
  id            TEXT        PRIMARY KEY,
  team_id       TEXT        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project       TEXT,
  insight_type  TEXT        NOT NULL,   -- 'practice'|'antipattern'|'profile'|'lesson'
  content       TEXT        NOT NULL,
  confidence    REAL        NOT NULL DEFAULT 0.5,
  source_count  INTEGER     NOT NULL DEFAULT 1,
  version       INTEGER     NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, insight_type, project)
);

CREATE INDEX IF NOT EXISTS idx_team_insights_team    ON team_insights(team_id);
CREATE INDEX IF NOT EXISTS idx_team_insights_project ON team_insights(team_id, project);

-- ─────────────────────────────────────────────────────────────────────────────
-- Team patterns
-- Per-user usage metrics, visible to the user and aggregated for the team.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_patterns (
  id            TEXT        PRIMARY KEY,
  user_id       TEXT        NOT NULL,
  team_id       TEXT        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project       TEXT,
  pattern_type  TEXT        NOT NULL,   -- 'prompt_category'|'session_frequency'|'contribution'
  metric        TEXT        NOT NULL,   -- e.g. 'prompts_logged', 'good_rate', 'share_count'
  value         REAL        NOT NULL,
  period        TEXT        NOT NULL DEFAULT 'monthly',
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_patterns_team ON team_patterns(team_id);
CREATE INDEX IF NOT EXISTS idx_team_patterns_user ON team_patterns(user_id, team_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Team sync cursor
-- Per-user watermark for team pull — separate from individual sync_cursor.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_sync_cursor (
  user_id      TEXT        NOT NULL,
  team_id      TEXT        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  last_pull_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, team_id)
);
