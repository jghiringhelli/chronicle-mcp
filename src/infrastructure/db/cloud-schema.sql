-- Chronicle Cloud Schema (Railway PostgreSQL)
-- 
-- This is the SYNC TARGET — not the primary store.
-- Local SQLite is the truth. This holds only what must travel between PCs.
--
-- Sync rules:
--   memories:   tier IN ('working','core') OR memory_type IN ('procedural','architectural')
--   insights:   all rows (intelligence layer — always sync)
--   sessions:   only ended sessions with a summary (session continuity)
--   sync_cursor: one row per device

-- ─────────────────────────────────────────────────────────────────────────────
-- Users (identity)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          TEXT        PRIMARY KEY,  -- stable user_id from ~/.chronicle/config.json
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Memories  (working + core tier only; buffer never leaves local)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memories (
  id               TEXT        PRIMARY KEY,
  user_id          TEXT        NOT NULL REFERENCES users(id),
  content          TEXT        NOT NULL,
  memory_type      TEXT        NOT NULL,   -- episodic|semantic|procedural|architectural|insight
  tier             TEXT        NOT NULL,   -- working|core  (buffer excluded)
  weight           REAL        NOT NULL,
  decay_rate       REAL        NOT NULL,
  access_count     INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL,
  last_accessed_at TIMESTAMPTZ NOT NULL,
  project          TEXT,                   -- NULL = cross-project
  category         TEXT,
  tags             TEXT[]      NOT NULL DEFAULT '{}',
  source           TEXT,
  confirmed        BOOLEAN     NOT NULL DEFAULT FALSE,
  fact_subject     TEXT,
  fact_predicate   TEXT,
  source_device    TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_user     ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_project  ON memories(user_id, project);
CREATE INDEX IF NOT EXISTS idx_memories_type     ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_tier     ON memories(tier);
CREATE INDEX IF NOT EXISTS idx_memories_weight   ON memories(weight DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Insights  (LLM-distilled intelligence layer — always sync in full)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insights (
  id            TEXT        PRIMARY KEY,
  user_id       TEXT        NOT NULL REFERENCES users(id),
  insight_type  TEXT        NOT NULL,   -- profile|lesson|playbook|bias
  project       TEXT,                   -- NULL = cross-project
  content       TEXT        NOT NULL,   -- JSON/YAML: the distilled knowledge
  confidence    REAL        NOT NULL DEFAULT 0.5,
  source_count  INTEGER     NOT NULL DEFAULT 1,
  version       INTEGER     NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, insight_type, project)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Session summaries  (continuity across PCs — "what was I working on?")
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_summaries (
  id            TEXT        PRIMARY KEY,
  user_id       TEXT        NOT NULL REFERENCES users(id),
  project       TEXT        NOT NULL,
  device        TEXT,
  summary       TEXT        NOT NULL,
  active_tasks  JSONB       NOT NULL DEFAULT '[]',
  touched_files JSONB       NOT NULL DEFAULT '[]',
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON session_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON session_summaries(user_id, project);
CREATE INDEX IF NOT EXISTS idx_sessions_ended   ON session_summaries(ended_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Sync cursor  (per-device watermark — enables incremental sync)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_cursor (
  device_id         TEXT        NOT NULL,
  user_id           TEXT        NOT NULL REFERENCES users(id),
  last_push_at      TIMESTAMPTZ,
  last_pull_at      TIMESTAMPTZ,
  memories_version  INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, user_id)
);
