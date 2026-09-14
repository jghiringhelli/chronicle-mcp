---
id: INSTALL-MCP
type: pattern
status: active
tier: T1
properties: [self-describing, executable]
obligations: 5
depends_on: [ADR-015, ADR-016]
---

# Using Chronicle from every AI session on one machine

The point of Chronicle is cross-project memory, so it must be registered **once per machine**, not
once per project. This document is the procedure and the reasoning. Verified on this machine on
2026-09-10 — `docs/evidence/mcp-smoke.json` is the run.

---

## Claude Code — user scope

```bash
claude mcp add --scope user chronicle -- node /absolute/path/to/chronicle/dist/cli.js
claude mcp list      # chronicle: ... - ✔ Connected
```

`--scope user` writes to `~/.claude.json` at the top level, so **every** project directory sees the
server. Without it, `claude mcp add` writes into the current project's entry and the other projects
see nothing — which is the opposite of what this tool is for.

Restart any running Claude Code session to pick up a newly registered server.

### Which command to register

| Form | When |
|---|---|
| `node <repo>/dist/cli.js` | You develop Chronicle. Rebuild and every instance picks up the change — no reinstall, one copy. This is what this machine uses. |
| `npx -y chronicle-mcp` | You only consume it. Stable and path-independent; costs a resolve on first run and pins you to the published version. |

If you register the repo path, remember `tsup` cleans `dist/` at the start of a build: a session
starting mid-build will fail to spawn. Rebuild when no session is starting, or register the npx form.

## Other hosts

| Host | Where | Notes |
|---|---|---|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` (Win), `~/Library/Application Support/Claude/` (mac) | `mcpServers` object; same command |
| Copilot CLI | `~/.copilot/mcp-config.json` | stdio |
| Cursor | Settings → MCP | stdio |
| Any MCP client | — | stdio, `node dist/cli.js` or `npx -y chronicle-mcp` |

## Verify it actually works, don't assume

```bash
pnpm run smoke     # node scripts/smoke-mcp.mjs
```

It runs against a **throwaway store** (`CHRONICLE_HOME` pointed at a temp directory), so your real
`~/.chronicle` is never touched. Pass `--keep` to leave the temp store in place for inspection.

Twelve checks against the **built** server as a real MCP client: the three-tool surface (ADR-011),
a memory surviving a round trip, **two concurrent instances** on one database (ADR-016), the session
lifecycle, and `axon` answering without a team configured. It writes
`docs/evidence/mcp-smoke.json`.

This is the step that matters. A green unit suite said nothing about the real boundary: 119 passing
tests did not notice that `session(action: 'end', project)` ignored `project` and failed with
`Session not found:` on an empty id. One smoke run did.

---

## What happens with several instances at once

This is the normal case, and it is a supported contract rather than an accident — see **ADR-016**.

Each Claude Code instance spawns its own Chronicle process, and all of them open the same
`~/.chronicle/chronicle.db`. That works because the database is opened in **WAL** mode, where
readers never block the writer and the writer never blocks readers; writes across instances are
serialised, waiting up to 5s (`busy_timeout`) rather than failing instantly.

What it means in practice:

- A memory stored in one instance is **immediately** readable in the others. No sync, no restart.
- Two instances writing at the same time is fine. Chronicle's writes are single-statement and
  sub-millisecond.
- `session start` / `session end` are **per project**, not per machine, so parallel sessions on
  different projects do not interfere.
- Tiers and decay are global, and decay runs at `session end`. Ending a session in one instance
  applies decay and tier promotion for everything — which is intended, not a leak: the memory store
  is one store.

Not supported: several **users** or several **machines** writing to one file. Cross-machine
convergence is the optional cloud mirror's job (`railwayUrl`), with last-access-wins conflict
resolution (EDR-003).

## Configuration

Everything lives in `~/.chronicle/config.json`, created on first run from `git config user.email`.

`CHRONICLE_HOME` overrides the directory itself — set it to run against a separate store (a test
run, a second profile, a scratch experiment) without touching `~/.chronicle`.

| Key | Effect when absent |
|---|---|
| `userId` | derived from git email; required |
| `dbPath` | `~/.chronicle/chronicle.db` |
| `railwayUrl` | **no cloud sync.** Every local operation is unchanged and nothing throws |
| `teamId` | **no coordination sync** |
| `teamToken` | `axon` answers with a licence message instead of coordinating |

All three optional keys absent is the normal single-developer install, and is the case the smoke
test covers.

## Requirements

Node **≥20**, any major including 24. No compiler, no build tools: `better-sqlite3@13` ships
Node-API binaries (ADR-015). If you see `Could not locate the bindings file`, something reinstalled
a per-ABI driver or re-enabled the gyp rebuild — read the first Known Pitfall in
`.claude/ledger.md` before changing anything else.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `✘ Failed to connect` in `claude mcp list` | `dist/` missing — run `pnpm run build` |
| Server connects, tools absent | Client cached the old tool list; restart the session |
| `Could not locate the bindings file` | Per-ABI driver or a gyp rebuild — see above |
| `Session not found:` | Fixed 2026-09-10; `session end` now resolves by project. Rebuild |
| `Axon requires a Chronicle Team license` | Expected without `teamToken`. Not an error |
| Memory written in one instance invisible in another | Different `dbPath`, or a stale process holding an old path |
