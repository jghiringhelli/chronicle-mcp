# Chronicle Team — Setup & Onboarding Manual

A reusable guide for running Chronicle as a shared team brain across machines and
companies, with a cloud (Railway) database. Hand this to any new teammate.

> **Mental model.** The AI assistant does the thinking — it analyzes a feature, reads
> the spec, and proposes the work breakdown. Chronicle's `axon` and `team` tools are
> just the **shared scratchpad and coordinator** the assistant writes to, so every
> teammate's assistant sees the same plan, status, and hard-won knowledge. You don't
> decompose by hand; you ask your assistant to, and it persists the result.

---

## 0. What you get

- **`axon`** — work coordination for a [Generative Specification](https://github.com/jghiringhelli/generative-specification)
  workflow: register contributors, let the assistant decompose a spec into a ranked
  work queue, assign tasks by role, gate merges on quality.
- **`team`** — shared knowledge: push/recall team memories, an assistant-driven
  `promote` that de-dupes and shares durable learnings, team insights curated by
  owners/leads, and prompt analytics.
- **`chronicle` / `session`** — each person's private local memory (six types), synced
  per-user across their own machines.

Coordination and knowledge are **gated by one team token** and share **one** cloud DB.

---

## 1. Prerequisites (every person)

- **Node.js ≥ 22.** Not a preference: `better-sqlite3@13` requires it, and on Node 20 its binding
  does not fail to load, it **segfaults** (ADR-022). Chronicle refuses to start on anything older and
  tells you why, rather than crashing.
- **A `userId` that matches your database role.** Chronicle derives one from your git email on
  first run, but on a team database that is **not** good enough: since ADR-024 the row filter looks
  your identity up by database role, so your `userId` must be exactly the one the owner mapped for
  you (`gabo`, not `gabo@example.com`). Get it from the owner and set it explicitly in §4. A
  mismatch is not a permission error you can read — it is a Chronicle that silently sees none of
  your rows.
  ```bash
  git config --global user.email "you@example.com"   # still worth setting; not the source of truth
  ```
- An MCP-capable assistant: **Claude Code** or **GitHub Copilot** (agent mode) — see §6.
- Install the server globally:
  ```bash
  npm install -g chronicle-mcp
  ```

---

## 2. One-time: provision the cloud database (owner)

1. Create a **PostgreSQL** instance on [Railway](https://railway.app) (New Project →
   Add PostgreSQL).
2. Open the Postgres service → **Connect** → copy the **public** connection string. It
   looks like:
   ```
   postgresql://postgres:PASSWORD@HOST.proxy.rlwy.net:PORT/railway
   ```
   Chronicle connects with TLS (`sslmode=require`) automatically.
3. Keep this string secret, and **do not hand it to anyone** — not even a teammate. It is the
   superuser: it owns the schema and ignores row-level security entirely. It is used exactly twice,
   by the owner, in §2 and §2b, and never appears in anybody's config.

   > *This section used to say it was "the `railwayUrl` everyone on the team will use". That was
   > true and it was the problem: while a client connects as `postgres`, RLS is not in force for it,
   > so every teammate could read every other teammate's private memories. See ADR-019 and ADR-023.*
4. Apply the schema once (idempotent — `CREATE TABLE IF NOT EXISTS`):
   ```bash
   DB_URL="postgresql://...public-url..." npx tsx scripts/init-cloud-db.ts
   ```

> The **team** tables auto-create on first team action, but the **individual sync**
> tables (`users`, `memories`, `insights`, `session_summaries`, `sync_cursor`) do not —
> run the init script once so personal cross-PC sync works on a fresh database.

---

## 2b. One-time: give each person their own database role (owner)

The superuser string is not what anyone connects with. Each person gets a confined role whose
identity the database enforces — they can read and write their own rows, the shared team tables, and
nothing else.

```bash
# Put Railway's DATABASE_PUBLIC_URL in ~/.chronicle/railway-admin.url (one line), then:
node scripts/apply-rls.mjs              # dry run: prints the plan, changes nothing
node scripts/apply-rls.mjs --apply
```

It reads the roster from `team_members`, so add people to the team first (§5). For each it creates:

| role | what it is for |
|---|---|
| `chronicle_app_<id>` | what that person's Chronicle connects with, every day |
| `chronicle_admin_<id>` | migrations and inspection; bypasses RLS by design (ADR-020) |

Connection strings are written to `~/.chronicle/cloud-roles.json` and **never printed**. Passwords
already issued are preserved — pass `--rotate` only when you intend to invalidate them.

Verify it actually confines, from the confined side:

```bash
node scripts/verify-isolation.mjs       # expects 15/15
```

That suite also proves it can still *detect* a leak, by replaying the same attack against a
throwaway table carrying the old vulnerable policy. If it ever reports `BLIND`, treat every other
result in the run as unverified.

**Hand each teammate only their own `app_connection_string`, over a private channel.** Never paste
one into a chat, an issue, or a commit.

---

## 3. One-time: create the team & owner token (owner)

With `railwayUrl` in your own config (see §4), run:

```bash
chronicle-mcp generate-token --team <team-slug>
```

This creates the team, mints a license token, and **registers you as the team owner**
(so you can curate insights and assign roles). Output:

```
Chronicle Team token generated for team: <team-slug>

  token: chron_xxxxxxxx...

Add to ~/.chronicle/config.json:
{ "teamId": "<team-slug>", "teamToken": "chron_xxxxxxxx..." }
```

Share three things with each teammate over a secure channel: **`railwayUrl`**,
**`teamId`**, **`teamToken`**.

---

## 4. Per person: configure `~/.chronicle/config.json`

Create/edit `~/.chronicle/config.json` (on Windows: `C:\Users\<you>\.chronicle\config.json`):

```json
{
  "userId": "gabo",
  "deviceId": "gabo-laptop",
  "railwayUrl": "postgresql://chronicle_app_gabo:PASSWORD@HOST.proxy.rlwy.net:PORT/railway?sslmode=require",
  "teamId": "<team-slug>",
  "teamToken": "chron_xxxxxxxx..."
}
```

- `userId` **must match the role the owner mapped for you**. Chronicle would otherwise derive it
  from your git email, and the database would refuse every write — quietly, as an empty store.
- `railwayUrl` is **your own `chronicle_app_*` string**, not the superuser one. If it says
  `postgres:` you have the wrong string; ask the owner for yours.
- `deviceId` is auto-generated, but set it by hand when you use more than one machine — it is what
  cross-PC sync keys its watermark on, and a readable name makes `sync_cursor` legible.
- `dbPath` is auto-generated; you don't need to add it.
- Omit `railwayUrl`/`teamId`/`teamToken` and Chronicle still works fully **local-only**
  (private memory, no team features).

Restart your assistant after editing config.

---

## 5. Per person: join the team

Ask your assistant (or it will, when it first uses a team action):

```
team({ action: "join" })            → registers your membership (role: member)
team({ action: "members" })         → confirm you and your teammates are listed
```

The owner can promote someone to help curate:

```
team({ action: "assign_role", target_user_id: "gabo", role: "lead" })
```

---

## 6. Register Chronicle in your assistant

### Claude Code

CLI (simplest):
```bash
claude mcp add chronicle --scope user -- chronicle-mcp
```
…or add to your Claude config / project `.mcp.json`:
```json
{ "mcpServers": { "chronicle": { "command": "chronicle-mcp" } } }
```

### GitHub Copilot (VS Code agent mode)

Create `.vscode/mcp.json` in the workspace:
```json
{ "servers": { "chronicle": { "type": "stdio", "command": "chronicle-mcp" } } }
```
Then open Copilot Chat → **Agent** mode → enable the `chronicle` tools. (Copilot's CLI
reads MCP config the same way.)

> Both clients speak the same MCP protocol, so the identical `chronicle-mcp` binary and
> the same `~/.chronicle/config.json` serve both — one install, shared by every client
> on the machine.

---

## 7. The daily workflow (assistant-driven)

You describe intent in plain language; the assistant calls the tools.

```
# 1. Tech lead / specwright: the assistant reads the project's GS spec
axon({ action: "spec_sync", project_dir: "/abs/path/to/repo", project: "<project>" })
   → returns spec sections, milestones, TODOs (it does NOT auto-create tasks)

# 2. Ask the assistant to analyze the feature and propose a breakdown, then persist it
axon({ action: "decompose", project: "<project>", packages: [ ...AI-derived... ] })
   → ranks packages by dependency criticality and stores the queue

# 3. Each contributor pulls their next unblocked task (by role)
axon({ action: "assign", project: "<project>", role_filter: "builder" })

# 4. Spec changes first → code → tests, then submit with quality results
axon({ action: "request_merge", id: "<pkg>", branch_name: "...", contributor_id: "<you>",
       forgecraft_score: 12, forgecraft_tier: 3, forgecraft_pass: true })

# 5. A merger approves; downstream work unblocks automatically
axon({ action: "resolve_merge", id: "<mr>", contributor_id: "<merger>", approve: true })

# 6. See the whole board
axon({ action: "status", project: "<project>" })   # or: chronicle-mcp --dashboard  (localhost:4321)
```

### Sharing what you learn

```
team({ action: "promote", project: "<project>" })   # assistant shares durable learnings, de-duped
team({ action: "recall", query: "auth", project: "<project>" })   # pull team pool + insights
team({ action: "curate_insight", insight_type: "practice", content: "...", project: "<project>" })  # owner/lead
```

---

## 8. Onboarding a new coworker (repeatable checklist)

For each new person (works the same whether they're at your company or another org —
they only need the connection string + token, not access to your machine):

1. They install Node ≥ 20 and `npm install -g chronicle-mcp`.
2. They run `git config --global user.email "<their email>"`.
3. You send them `railwayUrl`, `teamId`, `teamToken` securely.
4. They create `~/.chronicle/config.json` (§4) and register the MCP server (§6).
5. They run `team({ action: "join" })`; you confirm with `team({ action: "members" })`.
6. (Optional) You `assign_role` them `lead` if they should curate.
7. They register as an `axon` contributor for the project:
   ```
   axon({ action: "contributor_add", name: "Their Name", role: "builder",
          bandwidth: 30, project: "<project>" })
   ```

---

## 9. Reference

### Coordination roles (`axon`)
| Role | Does |
|---|---|
| `specwright` | Authors/maintains the GS spec (CLAUDE.md, ADRs, use-cases) |
| `builder` | Implements work packages |
| `merger` | Reviews/approves merges; gates on quality |
| `verifier` | Runs tests and scoring |
| `watcher` | Read-only monitoring |

### Team roles (`team`)
`owner` (token issuer) and `lead` may `assign_role` and `curate_insight`; `member` may
share, promote, recall, and log.

### Token management
Revoke a leaver's access on Railway:
```sql
UPDATE team_licenses SET revoked = TRUE WHERE token = 'chron_...';
```
Licensing fields (`tier`, `seats`) live on `team_licenses` for free/per-seat plans.

---

## 10. Troubleshooting

- **"Team features require a Chronicle Team license."** — `teamToken` missing/invalid in
  config, or it was revoked. Re-check §4; regenerate with §3 if needed.
- **Team actions do nothing / no sync.** — `railwayUrl` not set, or the DB is
  unreachable. Team features need it; private memory still works without it.
- **`promote` says it used `lexical`, not `semantic`.** — the optional `fastembed`
  model isn't installed or hasn't downloaded yet (first use needs network; it caches to
  `~/.chronicle/models`). De-dup still works lexically; semantic kicks in once the model
  is available.
- **Different people aren't seeing each other's work.** — confirm everyone shares the
  **same** `railwayUrl` and `teamId`, and that each ran `team join` /
  `axon contributor_add`.
