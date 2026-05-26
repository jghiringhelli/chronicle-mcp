/**
 * Railway PostgreSQL schema for Chronicle team coordination (Axon layer).
 *
 * Individual memory (memories, insights, sessions) lives in the existing
 * Railway schema managed by sync.ts. This file covers only the team-shared
 * coordination tables: contributors, work_packages, assignments, merge_requests.
 *
 * All tables are scoped by team_id. A single Railway instance can serve
 * multiple teams without data leakage.
 *
 * Apply with: await sql.unsafe(TEAM_SCHEMA_SQL)
 */

export const TEAM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_contributors (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  skills JSONB NOT NULL DEFAULT '[]',
  role TEXT NOT NULL,
  bandwidth_hours_per_week REAL NOT NULL DEFAULT 20,
  availability TEXT NOT NULL DEFAULT 'available',
  last_active_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_device TEXT
);

CREATE TABLE IF NOT EXISTS team_work_packages (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  spec_section TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  role_required TEXT NOT NULL,
  dependencies JSONB NOT NULL DEFAULT '[]',
  priority_rank REAL NOT NULL DEFAULT 0,
  parent_id TEXT,
  is_milestone BOOLEAN NOT NULL DEFAULT FALSE,
  branch_name TEXT,
  forgecraft_score INTEGER,
  forgecraft_tier INTEGER,
  forgecraft_pass BOOLEAN,
  assigned_to TEXT,
  assigned_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_device TEXT
);

CREATE TABLE IF NOT EXISTS team_assignments (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  work_package_id TEXT NOT NULL,
  contributor_id TEXT NOT NULL,
  role TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_device TEXT
);

CREATE TABLE IF NOT EXISTS team_merge_requests (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  work_package_id TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  from_contributor_id TEXT NOT NULL,
  forgecraft_score INTEGER,
  forgecraft_tier INTEGER,
  forgecraft_pass BOOLEAN,
  forgecraft_report TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejected_by TEXT,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_device TEXT
);

CREATE TABLE IF NOT EXISTS team_licenses (
  token TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  tier TEXT NOT NULL DEFAULT 'free',   -- free | team | company (seat-based billing)
  seats INTEGER                        -- NULL = unmetered (free / individual)
);

-- ── Team knowledge layer ────────────────────────────────────────────────────
-- Shared knowledge that crosses team members, distinct from the coordination
-- tables above. Memories stay user-specific; insights are team-level.

CREATE TABLE IF NOT EXISTS team_members (
  user_id TEXT NOT NULL,                          -- mirrors users.id (soft ref)
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',            -- owner | lead | member
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, team_id)
);

CREATE TABLE IF NOT EXISTS team_shared_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project TEXT,
  content TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  category TEXT,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompt_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project TEXT,
  pattern TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'neutral',
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT[] NOT NULL DEFAULT '{}',
  share_content BOOLEAN NOT NULL DEFAULT FALSE,
  raw_content TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_insights (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project TEXT,
  insight_type TEXT NOT NULL,                     -- practice | antipattern | profile | lesson
  content TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_count INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, insight_type, project)
);

CREATE TABLE IF NOT EXISTS team_patterns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project TEXT,
  pattern_type TEXT NOT NULL,                     -- prompt_category | session_frequency | contribution
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_contributors_team_project ON team_contributors(team_id, project);
CREATE INDEX IF NOT EXISTS idx_team_work_packages_team_project ON team_work_packages(team_id, project);
CREATE INDEX IF NOT EXISTS idx_team_work_packages_status ON team_work_packages(status);
CREATE INDEX IF NOT EXISTS idx_team_assignments_package ON team_assignments(work_package_id);
CREATE INDEX IF NOT EXISTS idx_team_merge_requests_team ON team_merge_requests(team_id, status);
CREATE INDEX IF NOT EXISTS idx_team_licenses_team ON team_licenses(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_tsm_team ON team_shared_memories(team_id);
CREATE INDEX IF NOT EXISTS idx_tsm_project ON team_shared_memories(team_id, project);
CREATE INDEX IF NOT EXISTS idx_tsm_user ON team_shared_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_logs_team ON prompt_logs(team_id);
CREATE INDEX IF NOT EXISTS idx_prompt_logs_outcome ON prompt_logs(team_id, outcome);
CREATE INDEX IF NOT EXISTS idx_team_insights_team ON team_insights(team_id);
CREATE INDEX IF NOT EXISTS idx_team_patterns_team ON team_patterns(team_id);
`;
