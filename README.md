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

Chronicle uses five cognitive memory types, each with its own decay rate and default tier:

| Type | What it stores | Decay | Default tier |
|------|---------------|-------|-------------|
| **Semantic** | Facts, concepts, how things work | Medium | Buffer |
| **Episodic** | Events, what happened, past decisions | Fast | Buffer |
| **Procedural** | How to do things, sequences, commands | None | Core |
| **Architectural** | Why it was built this way, ADRs, tradeoffs | None | Core |
| **Preference** | Your style, habits, tooling choices | Slow | Working |

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

Create `~/.chronicle/config.json`:

```json
{
  "userId": "your-username",
  "deviceId": "laptop-home",
  "dbPath": "/path/to/chronicle.db"
}
```

Optional — add `railwayUrl` to enable cross-PC sync:
```json
{
  "userId": "your-username",
  "deviceId": "laptop-home",
  "dbPath": "/path/to/chronicle.db",
  "railwayUrl": "postgres://..."
}
```

---

## MCP tools

| Tool | What it does |
|------|-------------|
| `remember` | Store a memory with type, project, tags, and optional confirmation |
| `recall` | Retrieve memories ranked by relevance and weight |
| `forget` | Delete a memory by ID |
| `session_start` | Begin a session; returns compressed prior context |
| `session_end` | End a session with a summary |
| `session_recover` | Recover context from a crashed/interrupted session |
| `set_trigger` | Attach a trigger to a memory (fires on action keywords) |
| `check_triggers` | Check what memories fire before an action |
| `trigger_remove` | Remove a trigger |
| `set_preference` | Store a developer preference |
| `get_preferences` | Retrieve preferences, optionally filtered by category |
| `decay_run` | Run the decay job manually (normally automatic) |
| `stats` | Memory stats: counts by type, tier, weight distribution |

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
       ├── MemoryService    — remember / recall / decay / tier promotion
       ├── SessionService   — start / end / recover
       ├── TriggerService   — set / check / remove
       ├── PreferenceService — set / get
       └── SyncService      — Railway push / pull
              │
       SQLite (better-sqlite3, local-first)
       Railway Postgres (optional, Working+Core sync)
```

Domain is pure TypeScript with zero external imports. All repositories are synchronous (better-sqlite3). The MCP layer is async. Sync to Railway uses the `postgres` package with dynamic import.

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
