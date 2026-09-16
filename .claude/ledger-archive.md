---
node: ledger-archive
type: sentinel-node
scope: corrections older than 2026-09-12, moved out of the always-loaded ledger
load: on-demand
categories: [constraints]
routes_to: [ledger]
---

# Ledger Archive

> Entries moved here from `.claude/ledger.md` so that node stays inside its 300-line read budget.
> **Nothing is deleted** — the ledger is append-only, and this file is where appended things go when
> the live node fills up. A lesson here is exactly as binding as one there; it is only older.
>
> Read this when a change touches the driver, the schema, the hooks or the cloud roles, or when a
> correction in the live ledger cites a date before 2026-09-12.

---

## Corrections Log — archived

- `[2026-09-10]` — Never hand-type a status claim. A "passing" / "done" / "✅" line is
  admissible only when it cites an execution record under `docs/evidence/` (run id or
  timestamp). Status is a function over evidence, never prose.
  *Origin: `Status.md` claimed "Tests: 39/39 passing" and "Typecheck: clean" while `tsc`
  exited 2 and 11 of 41 tests failed.*
- `[2026-09-10]` — Never ship a capability without a use case and, if it is an
  architectural choice, an ADR. The `axon` tool surface and the cloud sync service both
  landed with neither, which made them ghost code under the cascade check.
- `[2026-09-10]` — Never leave a required cascade artifact as an unfilled template.
  An empty `docs/PRD.md` in the functional-spec slot scores worse than an absent one:
  it reports the shape of rigour with none of the guarantee.
- `[2026-09-10]` — When the spec and the code disagree, the change is not done. Fix the
  spec in the same commit or revert the code. `docs/spec.md §6` listed cloud sync, team
  memory and the dashboard as out of scope while all three were implemented.
- `[2026-09-10]` — Never describe a gate in a standards file without emitting it. The
  repo's own `cicd.md` demanded `.github/workflows/ci.yml` and a mutation gate; neither
  existed. Emit the file, then reference it.
- `[2026-09-10]` — Reject any count claim about the memory model that is not derived from
  `src/domain/types.ts`. "Five", "six" and "three-tier" were all in circulation at once.
- `[2026-09-10]` — Before calling a default a defect, check the driver's own defaults, not just
  SQLite's. `busy_timeout` and `foreign_keys` were diagnosed as missing; `better-sqlite3` already
  sets both. WAL was the only load-bearing pragma, and it was already there. The real gap was that
  nothing *pinned* any of it (ADR-016).
- `[2026-09-10]` — A threshold that has never run is an aspiration, not a ratchet position. Set a
  gate's floor to the measured value and raise it; never lower a floor that has held. Coverage and
  MSI were both declared and never evaluated — 80% and 65% against actuals of 15% and 9%.
- `[2026-09-10]` — Exercise the real boundary before believing the unit suite. 119 green unit
  tests did not find that `session(action:'end', project)` ignored `project` and failed with
  `Session not found: ` on an empty id. One run of `scripts/smoke-mcp.mjs` did.
- `[2026-09-10]` — Do not retype uncovered code to satisfy a new lint rule. Characterise it with
  tests first, then type it. A scoped, expiring waiver is the correct interim (exc-009).
- `[2026-09-11]` — `userId` is an identity, not a convenience. It keys team membership and every
  synced row, and it was being re-derived from `git config user.email` whenever the config file was
  recreated — which silently orphaned this machine's membership in its own team. Derive once, then
  treat as immutable; changing it means migrating the rows it owns.
- `[2026-09-11]` — `BYPASSRLS` does not grant table access. It lets a role ignore policies; the role
  still needs SELECT. The first isolation verification failed on the admin with
  `permission denied for table memories` for exactly this reason.
- `[2026-09-11]` — State an isolation guarantee at the strength it actually holds. Two admins means
  RLS does not hide them from each other, and a test that omitted that would imply a guarantee that
  does not exist. `verify-isolation.mjs` asserts the admin DOES see everything, on purpose.
- `[2026-09-10]` — An error that cannot say why it failed is an error nobody can act on.
  `StorageError` stashed its cause in `context` and nothing printed it, so a real cloud failure
  reached the user as `Error: Team sync failed`. The cause now goes in the message.
- `[2026-09-10]` — A test that writes to the real store is a test nobody runs twice. Point
  `CHRONICLE_HOME` at a temp directory for any run that touches a database. The first
  `scripts/smoke-mcp.mjs` left rows in `~/.chronicle/chronicle.db`, which also meant its
  concurrency checks were racing whatever the real store happened to hold.
- `[2026-09-10]` — "Optional dependency" does not mean "not installed". `optionalDependencies`
  install by default; the flag only says "do not fail the install if it cannot be built". An
  accepted risk premised on a package being absent is an accepted risk premised on nothing
  (ADR-017 supersedes ADR-003 on exactly this).
- `[2026-09-10]` — Prove a gate blocks by making it block. Committing a deliberate violation is the
  only evidence that a hook is wired; it is also how the four silently-disabled hook scripts below
  were found, after the hook had already been declared working.

---
