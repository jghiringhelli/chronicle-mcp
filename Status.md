# Status.md

## Last Updated: 2026-04-07
## Session Summary
Phase p6-deploy blockers resolved. Chronicle MCP server fully implemented and tested.

## Build Status
**Phase:** complete  
**Result:** ✅ READY

### Resolved Blockers
| Issue | Was | Now |
|-------|-----|-----|
| ERR-001 | Missing exception hierarchy | ✅ ChronicleError + 6 subclasses in src/shared/exceptions/ |
| TST-001 | Zero test coverage | ✅ 39 tests passing, 4 test files |
| TSC-001 | Missing noUncheckedIndexedAccess | ✅ Added to tsconfig.json |
| CFG-001 | No config module | ✅ src/shared/config/index.ts — reads ~/.chronicle/config.json |

## Architecture

### Local (primary store)
- `~/.chronicle/chronicle.db` — SQLite, full schema (all 5 memory types, 3 tiers)
- Started via: `node dist/cli.js` (stdio MCP) or `node dist/cli.js --http --port 3100`

### Cloud Sync (Railway Postgres — optional)
- 4 tables: `memories` (working+core), `insights`, `session_summaries`, `sync_cursor`
- Schema: `src/infrastructure/db/cloud-schema.sql`
- Triggered at session boundaries (session_end → push, session_start → pull)
- Distillation: LLM updates intelligence layer (profile/lessons/playbook) on session_end
- Configure: set `railwayUrl` in `~/.chronicle/config.json`

### MCP Config
| Client | File | Status |
|--------|------|--------|
| Copilot CLI | `~/.copilot/mcp-config.json` | ✅ configured (stdio) |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | ✅ configured (stdio) |

## MCP Tools
remember, recall, forget, session_start, session_end, check_triggers, set_trigger, set_preference, get_preferences

## Current Context
- Build: passing (`pnpm run build` ✅)
- Typecheck: clean (`pnpm run typecheck` ✅)
- Tests: 39/39 passing (`pnpm run test --run` ✅)
- Next: Set Railway Postgres URL in `~/.chronicle/config.json` → sync enabled

## Deployment Status
**Phase:** p6-deploy  
**Task:** pipeline-p6-deploy-deploy  
**Result:** ❌ DEPLOYMENT BLOCKED

### Blocker Analysis

The code review verdict (p5-review) returned **Changes Requested** with three critical blocking issues:

| Issue ID | Category | Severity | Status | Blocker |
|----------|----------|----------|--------|---------|
| ERR-001 | Error Handling | HIGH | UNRESOLVED | YES |
| TST-001 | Test Coverage | CRITICAL | UNRESOLVED | YES |
| TSC-001 | TypeScript Config | MEDIUM | UNRESOLVED | YES |

### Critical Blockers

1. **ERR-001: Missing Exception Hierarchy**
   - Location: `src/shared/exceptions/` (empty)
   - Impact: No proper error handling in domain layer
   - Required: ChronicleError base class with subclasses (NotFoundError, ValidationError, StorageError, EmbeddingError, ConfigurationError)

2. **TST-001: Zero Test Coverage**
   - Location: `tests/` (does not exist)
   - Current Coverage: 0%
   - Required: ≥80% line coverage per CLAUDE.md
   - Missing: Unit tests for domain entities, weight formulas, session state transitions

3. **TSC-001: TypeScript Configuration Gap**
   - Missing: `noUncheckedIndexedAccess: true` in tsconfig.json
   - Impact: Unsafe environment variable access patterns allowed

### Non-Blocking Issues

4. **CFG-001:** Configuration module not implemented
   - Location: `src/shared/config/` (empty)
   - Impact: Database path, embedding model selection not configurable

### Deployment Target Analysis

✗ No deployment configuration found in project root
- No `railway.json` or `railway.toml` (Railway)
- No `vercel.json` (Vercel)
- No `fly.toml` (Fly.io)
- No `Dockerfile` (Container registry)
- `package.json` has no `publishConfig` (npm publish)

**Conclusion:** Code cannot be deployed due to review blockers; no deployment target configured.

## Current Context
- Working on: MCP integration setup + session registry
- Blocked by: Chronicle MCP server not yet implemented (ERR-001, TST-001, TSC-001)
- MCP config: Configured for stdio in `~/.copilot/mcp-config.json` and Claude Desktop
- Session registry: `~/.chronicle/registry.json` (git-anchored, see scripts/)
- Next steps: Implement MCP server entry point + HTTP transport

## MCP Integration Status

### Config files (done)
| Client | Config file | Transport | Status |
|--------|-------------|-----------|--------|
| Copilot CLI | `~/.copilot/mcp-config.json` | stdio (→ HTTP when ready) | ✅ configured |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | stdio (→ HTTP when ready) | ✅ configured |

### What Chronicle still needs to serve MCP
1. **`src/mcp/server.ts`** — MCP server entry, registers tools (remember, recall, session_start…)
2. **`src/cli.ts`** — CLI entry point, parses `--http --port` flag
3. **`dist/index.js`** — Built output (requires fixing ERR-001, TST-001, TSC-001 first)
4. **HTTP transport** (phase 2): switch config to `http://localhost:3100/mcp` + run `scripts/start-chronicle.ps1`

### Why stdio now, HTTP later
State lives in SQLite. Each session spawns its own Chronicle process but they share the DB.
HTTP daemon is needed once 2+ AI sessions run simultaneously and write concurrently.

## Feature Tracker
| Feature | Status | Branch | Notes |
|---------|--------|--------|-------|
| Domain Layer | ✅ Complete | master | Excellent SOLID/architecture; blocked on error handling & tests |
| Exception Hierarchy | ⬚ Not Started | - | Blocks deployment (ERR-001) |
| Unit Tests | ⬚ Not Started | - | Blocks deployment (TST-001, 0% coverage) |
| Configuration Module | ⬚ Not Started | - | Non-blocking (CFG-001) |
