# Chronicle MCP

**Persistent, tiered AI memory that survives context resets — for Claude, GitHub Copilot, Cursor, and any MCP-compatible assistant.**

---

Every AI session starts blank. You explain your stack, your decisions, your preferences — *again*. You re-discover the same bugs. You re-justify the same architecture. Chronicle solves this.

Chronicle is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives your AI assistant a cognitive memory system modelled on how humans actually remember things. Not a flat list of notes — a tiered, weighted, self-organizing memory that grows stronger when accessed and fades when irrelevant.

---

## What it does

- **Remembers** project context, architectural decisions, hard-won solutions, and your preferences across every session and every AI client
- **Recalls** the right memory at the right time — ranked by relevance, recency, and how often you've needed it before
- **Decays** memories that stop mattering and reinforces the ones that keep coming up
- **Fires triggers** before risky actions ("you were about to deploy — here's what broke last time")
- **Recovers** interrupted sessions with a compressed context summary
- **Syncs** across machines via Railway Postgres

---

## Memory model

Chronicle uses six cognitive memory types, each with its own decay rate and default tier:

| Type | What it stores | Decay | Default tier |
|------|---------------|-------|-------------|
| **Semantic** | Facts, concepts, how things work | Medium | Buffer |
| **Episodic** | Events, what happened, past decisions | Fast | Buffer |
| **Procedural** | How to do things, sequences, commands | None | Core |
| **Architectural** | Why it was built this way, ADRs, tradeoffs | None | Core |
| **Insight** | Patterns spotted across sessions, recurring lessons | Slow | Working |
| **Coordination** | Team state, hand-offs, who-is-doing-what | Medium | Working |

Developer **preferences** (style, habits, tooling choices) are stored separately via the `pref` action — they live in their own table with no decay.

### Three tiers

```
Buffer (ephemeral)  →  Working (session-relevant)  →  Core (permanent)
weight decays fast      accessed 3+ times               accessed 10+ times
                                                         never decays
```

Memories promote automatically as you access them. Architectural and Procedural memories start in Core and never decay.

---

## Quick start

### Claude Desktop / Claude Code

Add to `~/.config/Claude/claude_desktop_config.json` (or `~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "chronicle": {
      "command": "npx",
      "args": ["-y", "chronicle-mcp"],
      "env": {
        "CHRONICLE_DB": "/path/to/your/chronicle.db"
      }
    }
  }
}
```

### GitHub Copilot CLI

Add to `~/.copilot/mcp-config.json` (user-level, all projects):

```json
{
  "mcpServers": {
    "chronicle": {
      "command": "npx",
      "args": ["-y", "chronicle-mcp"],
      "env": {
        "CHRONICLE_DB": "/path/to/your/chronicle.db"
      }
    }
  }
}
```

Or drop a `.copilot/mcp-config.json` in a specific project folder for per-project config.

### Cursor / VS Code / any MCP client

Same pattern — point your MCP client at `npx chronicle-mcp` with `CHRONICLE_DB` set to a shared path.

### Configuration file

Chronicle creates `~/.chronicle/config.json` automatically on first run, using your `git config --global user.email` as `userId`. No manual setup needed on any machine where git is configured.

```json
{
  "userId": "you@example.com",
  "deviceId": "hostname-a1b2",
  "dbPath": "/home/you/.chronicle/chronicle.db"
}
```

Optional fields:

| Field | Purpose |
|-------|---------|
| `railwayUrl` | PostgreSQL connection string — enables cross-PC sync |
| `teamId` | Team slug — enables Axon team coordination |
| `teamToken` | Team license token — required to use Axon tools |

Full config with all features:
```json
{
  "userId": "you@example.com",
  "deviceId": "hostname-a1b2",
  "dbPath": "/home/you/.chronicle/chronicle.db",
  "railwayUrl": "postgresql://user:pass@host.railway.app:5432/railway",
  "teamId": "my-team",
  "teamToken": "chron_..."
}
```

---

## MCP tools

> **Designed to be invoked at the right moments.** Tool descriptions are written as agent-instructive guidance, not mechanical one-liners — they tell the AI assistant *when* to recall (at the start of any substantive block, decision point, returning to a topic) and *when* to remember (after every architectural decision worth inheriting in the next session). The result: chronicle is used as the structural memory backbone, not as an occasional note-taking tool. See `src/mcp/server.ts` for the canonical descriptions.

### `chronicle` — memory, triggers, preferences

| Action | What it does |
|--------|-------------|
| `remember` | Store a memory with type, project, tags, and optional confirmation |
| `recall` | Retrieve memories ranked by relevance and weight |
| `forget` | Delete a memory by ID |
| `trigger` | Attach a trigger to a memory (fires on action keywords) |
| `check` | Check what memories fire before an action |
| `pref` | Store a developer preference |
| `prefs` | Retrieve preferences, optionally filtered |
| `stats` | Memory counts by type, tier, weight |
| `decay` | Run the decay + tier promotion job manually |

### `session` — session lifecycle

| Action | What it does |
|--------|-------------|
| `start` | Begin a session; returns core memories for context |
| `end` | End a session with a summary; triggers Railway sync |
| `recover` | Recover context from a crashed or interrupted session |

### `axon` — team coordination *(requires teamToken)*

| Action | What it does |
|--------|-------------|
| `contributor_add` | Register a team member with role and bandwidth |
| `spec_sync` | Read GS spec artifacts from a project directory |
| `milestone_add` | Create a milestone work package |
| `decompose` | Break a spec into ranked, dependency-ordered work packages |
| `assign` | Assign the next unblocked package to an available contributor |
| `complete` | Mark a work package done; unblocks downstream packages |
| `request_merge` | Submit work for merger review with ForgeCraft results |
| `resolve_merge` | Approve or reject a merge request |
| `merges` | List merge requests filtered by status |
| `status` | Full team dashboard: contributors, queue, merge queue |
| `queue` | Ranked work queue for the project |

---

## Example session

```
You: start a session for this project
AI: [calls session_start({project: "my-app"})]
    → "3 core memories loaded: auth uses Lucia v3, Postgres on Railway,
       prefer functional patterns over classes. 1 trigger active: deploy"

You: let's add Redis for caching
AI: [calls check_triggers({action: "deploy", project: "my-app"})]
    → ⚠️  CRITICAL: Redis eviction policy resets on Railway deploy.
       Pin config in deploy hook. (last seen 12 days ago)
```

```
You: remember that we chose Zod over Valibot because Zod has better
     ecosystem support and our team already knows it
AI: [calls remember({
      content: "chose Zod over Valibot — better ecosystem, team familiarity",
      memory_type: "architectural",
      project: "my-app",
      confirmed: true
    })]
    → Stored in Core tier. Will never decay.
```

---

## Cross-project memory

One database, multiple projects. Memories without a `project` field are global — they surface in every session.

```
# In project "new-api":
recall({query: "Railway environment variables at build time"})
→ Returns: solution from "old-app" — "echo in build command to confirm
   injection timing" (cross-project, weight: 0.72)
```

---

## Cross-PC sync (Railway Postgres)

Chronicle is local-first. Your SQLite database is the primary store — fast, offline-capable, zero latency. **You only need this if you work across multiple machines.**

When you set `railwayUrl`, Chronicle syncs your Working and Core tier memories plus distilled intelligence to Railway Postgres. Any device with the same `userId` and a `railwayUrl` pulls those memories in automatically.

```
Machine A (home laptop)  →  Railway Postgres  →  Machine B (work laptop)
  remembers + writes              ↑ sync                pulls on session_start
```

Only Working+Core memories sync (not ephemeral Buffer). Your local SQLite always has the full picture.

### Setup (5 minutes)

1. Go to [railway.app](https://railway.app) → **New Project** → **Add Postgres**
2. Click the Postgres service → **Connect** tab → copy the connection string
3. Add it to `~/.chronicle/config.json`:
   ```json
   {
     "userId": "your-username",
     "deviceId": "laptop-home",
     "dbPath": "/path/to/chronicle.db",
     "railwayUrl": "postgresql://user:pass@host.railway.app:5432/railway"
   }
   ```
4. Apply the cloud schema once:
   ```bash
   psql "postgresql://..." -f path/to/chronicle-mcp/src/infrastructure/db/cloud-schema.sql
   ```

Sync activates automatically on the next `session_start`. No restart needed.

> **Tip:** If you use an AI assistant (Copilot, Claude) to do this setup, ask it to look up your Railway project, find the Postgres connection string, and write it into `~/.chronicle/config.json` directly.

---

## Adding a project

No registration needed. Use the `project` field when calling `remember` or `recall`:

```json
{ "name": "remember", "arguments": {
    "content": "This project uses Turborepo monorepo with pnpm workspaces",
    "memory_type": "architectural",
    "project": "my-monorepo",
    "confirmed": true
}}
```

Seed key facts at the start: stack, key decisions, gotchas. Chronicle handles the rest.

---

## Session resumption across restarts

For reliable session tracking across PC restarts, Chronicle includes session scripts that anchor sessions to their git repository root commit SHA (survives folder renames and moves):

```powershell
# Register after starting a session:
.\scripts\register-session.ps1 -Client copilot -Account work -SessionId <id>

# Resume on next boot:
.\scripts\resume-session.ps1

# List all registered sessions:
.\scripts\list-sessions.ps1
```

See [`scripts/README.md`](scripts/README.md) for details.

---

## Architecture

```
MCP Client (Claude / Copilot / Cursor)
       │  stdio / HTTP
       ▼
  Chronicle MCP Server  (src/mcp/server.ts)
       │
       ├── chronicle tool
       │     ├── MemoryService     — remember / recall / decay / tier promotion
       │     ├── TriggerService    — set / check
       │     └── PreferenceService — set / get
       ├── session tool
       │     └── SessionService    — start / end / recover
       └── axon tool  (teamToken required)
             ├── CoordinationService — contributors, work packages, assignments, merges
             └── syncCoordination    — Railway push / pull (team state)
                    │
             SQLite (better-sqlite3, local-first)
             Railway Postgres (optional — cross-PC sync + team coordination)
```

Domain is pure TypeScript with zero external imports. All repositories are synchronous (better-sqlite3). The MCP layer is async. Sync to Railway uses the `postgres` package with dynamic import.

---

## Axon — team coordination for GS workflows

Axon is Chronicle's team coordination layer for [Generative Specification](https://github.com/jghiringhelli/generative-specification) workflows. It decomposes a GS spec into a ranked, dependency-ordered work queue, assigns packages to contributors by role, and gates merges on ForgeCraft quality scores — all synced in real time across the team via Railway.

**Requires a team license token.** Contact [PragmaWorks](https://github.com/jghiringhelli) or generate one yourself if you run your own Railway instance (see below).

### Role model

| Role | Responsibility |
|------|---------------|
| `specwright` | Authors and maintains GS spec artifacts (CLAUDE.md, ADRs, use-cases) |
| `builder` | Implements work packages derived from the spec |
| `merger` | Reviews and approves merge requests; gates on ForgeCraft tier |
| `verifier` | Runs tests and quality checks |
| `watcher` | Monitors — read-only visibility into team state |

### Setup

1. **Railway Postgres** — same instance as cross-PC sync (see above). The team schema is applied automatically on first use.

2. **Generate a token** (run once, by the team lead):
   ```bash
   chronicle-mcp generate-token --team my-team
   ```
   Output:
   ```
   Chronicle Team token generated for team: my-team

     token: chron_a1b2c3...

   Add to ~/.chronicle/config.json:
   {
     "teamId": "my-team",
     "teamToken": "chron_a1b2c3..."
   }
   ```

3. **Each team member** adds `teamId` and `teamToken` to their `~/.chronicle/config.json`:
   ```json
   {
     "userId": "you@example.com",
     "railwayUrl": "postgresql://...",
     "teamId": "my-team",
     "teamToken": "chron_a1b2c3..."
   }
   ```

4. **Register contributors** — once per person:
   ```
   axon({ action: "contributor_add", name: "Alice", email: "alice@example.com",
          role: "builder", bandwidth: 30, project: "my-project" })
   ```

### Typical GS workflow

```
# 1. Specwright syncs the spec
axon({ action: "spec_sync", project_dir: "/path/to/repo", project: "my-project" })
→ Returns spec sections, milestones, TODOs for AI-driven decomposition

# 2. AI decomposes into ranked work packages
axon({ action: "decompose", project: "my-project", packages: [
  { title: "Auth service", role_required: "builder", depends_on: [] },
  { title: "Auth tests",   role_required: "verifier", depends_on: ["Auth service"] }
]})

# 3. Each contributor gets their next assignment
axon({ action: "assign", project: "my-project", role_filter: "builder" })
→ { workPackage: { title: "Auth service", branchName: "feature/my-project/auth-service" },
    contributor: { name: "Alice" } }

# 4. Builder completes work, submits with ForgeCraft results
axon({ action: "request_merge", id: "<pkg-id>", branch_name: "feature/...",
       contributor_id: "<alice-id>", forgecraft_score: 12, forgecraft_tier: 3, forgecraft_pass: true })

# 5. Merger reviews and approves
axon({ action: "resolve_merge", id: "<mr-id>", contributor_id: "<merger-id>", approve: true })

# 6. Monitor progress
axon({ action: "status", project: "my-project" })
```

### Dashboard

```bash
chronicle-mcp --dashboard
```

Opens a local web UI at `http://localhost:4321` with three views: team overview, project queue, and personal assignments.

### Token management

Tokens are stored in the `team_licenses` table on your Railway instance. To revoke a token:

```sql
UPDATE team_licenses SET revoked = TRUE WHERE token = 'chron_...';
```

---

## Development

```bash
git clone https://github.com/jghiringhelli/chronicle-mcp
cd chronicle-mcp
pnpm install
pnpm approve-builds   # approve better-sqlite3 + esbuild native builds
pnpm run build
pnpm run test
```

```bash
pnpm run typecheck    # zero errors
pnpm run test:coverage
```

---

## Roadmap

- [ ] Vector embeddings for semantic `recall` (currently keyword/tag-based)
- [ ] `distill` tool — LLM-synthesised playbooks, profile.yaml, lessons.yaml
- [ ] Web UI for memory browser and cross-project graph
- [ ] Ecosystem Registry — propagate decisions across related projects
- [ ] `npx chronicle-mcp` zero-config cold start

---

## License

MIT © [Juan Carlos Ghiringhelli](https://github.com/jghiringhelli)

---

*Built as part of the [PragmaWorks](https://github.com/jghiringhelli) suite of developer tools.*


---

## Part of Generative Specification

A free tool behind **Generative Specification (GS)** — the discipline for building software with AI that doesn't drift: you author a specification precise enough that a stateless AI derives correct code from it, and a harness verifies it against a live system.\n\n- \U0001F4C4 **White paper** (open access): https://doi.org/10.5281/zenodo.21726017\n- \U0001F9ED **Start here** — method, tools, testimonials: https://pragmaworks.dev\n- \U0001F528 **The Forge** — 2-day hands-on GS workshop for your team: https://forgeworkshop.dev\n