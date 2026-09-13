---
node: ledger
type: sentinel-node
scope: corrections log and known pitfalls — the repo's memory for the stateless reader
load: always
categories: [constraints]
routes_to: [root]
---

# Ledger — Corrections and Pitfalls

> Always loaded. The stateless reader cannot remember that it hit a trap yesterday;
> this node is how the repository remembers *for* it. Append-only: entries are never
> deleted, only superseded with a dated line. This is the ratchet.

---

## Corrections Log

Behavioural deviations that were corrected once and must not recur. One dated line each.
When the user says *"don't do that"* about a pattern produced here, append a line.

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
- `[2026-09-12]` — A gate that has never failed has not been verified. The Node 20/24 matrix was
  added by ADR-015 so that `engines.node` was *tested rather than asserted*; its first real run
  segfaulted on Node 20, because `better-sqlite3@13` had raised its own floor to `>=22` and this
  package still claimed `>=20`. 283 green tests on Node 24 could not have found it — the only
  instrument that could was a second Node version, and the only place one exists is CI. ADR-015's
  Verification section had recorded the range as verified before the matrix ever ran against `@13`.
- `[2026-09-12]` — When a dependency bumps a major, re-read its `engines`, not just its changelog.
  A raised floor is silent: the install still succeeds, because npm and pnpm treat an engine mismatch
  as a warning. The symptom was `Segmentation fault (core dumped)`, exit 139, no stack — the failure
  mode with the least diagnostic information available. `dependency-policy` rule 9 now gates the
  floor, and `src/shared/runtime.ts` makes the process say what is wrong instead of dying.
- `[2026-09-12]` — If correctness depends on import order, make it depend on the language instead.
  A guard that must be evaluated before a native module is only correct while its `import` line stays
  above the others — one import sorter away from a segfault on someone else's machine. `cli.ts` now
  loads the server with `await import()`, so the ordering is guaranteed rather than conventional.
- `[2026-09-12]` — Measure before optimising, and say so when the guess was wrong. I predicted
  NFR-03 would miss (leading-wildcard scan, two queries per recall) and it meets at p95 13ms; I added
  a schema-version gate expecting it to cut cold start and it moved nothing — the cost is Node plus
  the MCP SDK, ~165ms before the app runs. Two wrong predictions in one session is the argument for
  `scripts/bench-nfr.mjs`.
- `[2026-09-12]` — A loop of single-row writes is not a pass, it is thousands of transactions.
  `better-sqlite3` autocommits every statement: the decay pass took 10.4s at 50k against a 500ms
  budget. One transaction took it to 1.08s; moving the arithmetic into SQL (`exp()` ships since 3.35)
  took it to 363ms. 28×, on a path that runs at every session end.
- `[2026-09-12]` — If a formula exists twice, bind the copies with a test. The decay rule is now in
  the domain and in SQL; `sqlite-decay-parity.test.ts` pins them to nine decimals, and that test is
  the only thing making the duplication acceptable.
- `[2026-09-12]` — A skipped test must say so loudly. `driver-upgrade.test.ts` cannot install
  `better-sqlite3@11` on a machine with no C++ toolchain — ADR-015's original problem — so it warns on
  stderr and asserts the skip. A green tick for an assertion that never ran is worse than no test.
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

## Known Pitfalls

Technology traps, not behavioural ones. Three parts each: what goes wrong, the wrong
pattern, the right one.

### A native dependency that builds from source will fail silently until runtime

**What goes wrong.** `better-sqlite3@11.x` publishes **per-ABI** prebuilds — one binary per Node
major. None exists for Node 24 (ABI 137), so `install` falls through to `node-gyp`, which needs a
Visual Studio C++ toolchain on Windows. Without it the package installs "successfully" and every
`new Database()` throws `Could not locate the bindings file` at runtime. Eleven of forty-one tests
failed in a way that reads exactly like a code bug.

- **Wrong:** `better-sqlite3@^11` with `"engines": { "node": ">=20" }`. The engines field promises
  a range the dependency cannot honour.
- **Wrong, second time:** "fix" it by narrowing `engines` to `>=20 <24` and pinning CI to Node 20.
  That describes v11's limitation accurately and makes every consumer's Node version your problem.
- **Right:** `better-sqlite3@^13`, which ships **Node-API** prebuilds — one ABI-stable binary per
  platform (`prebuilds/win32-x64.node`, no Node version in the filename). No compiler, no Node pin,
  works on future majors. `engines` goes back to an open `>=20`, which is now the *accurate*
  statement. See ADR-015.
- **The non-obvious half:** a NAPI package that still carries a `binding.gyp` MUST be kept **out**
  of pnpm's `onlyBuiltDependencies`, or pnpm runs `node-gyp rebuild` anyway and the shipped binary
  is never used. The resulting `Ignored build scripts: better-sqlite3` warning is the desired state.

**How to tell which kind a package is:** `ls node_modules/<pkg>/prebuilds`. Names like
`win32-x64.node` are NAPI; names like `better_sqlite3-v11.10.0-node-v137-win32-x64` are per-ABI.

### `CREATE TABLE IF NOT EXISTS` is not a migration

**What goes wrong.** Adding a column to the schema file does nothing to a database that already
exists — `IF NOT EXISTS` skips the whole statement, column and all. Worse, an index on the new column
*is* created, and it throws: `no such column: scope`. The server then fails to start on every store
that predates the change, which for a user-scope MCP server means every AI session on the machine.

- **Wrong:** adding a column to `SCHEMA_SQL` and assuming startup applies it.
- **Right:** tables, then **column migrations**, then indexes — in that order, because an index on a
  new column cannot precede the column. `migrateLocalSchema()` in `database.ts` holds the list, checks
  `PRAGMA table_info` and adds only what is missing. Every entry needs a DEFAULT or must be nullable:
  there is no chance to backfill before the column exists.
- **Verify it on an OLD database, not a fresh one.** `tests/unit/infrastructure/local-migration.test.ts`
  builds a pre-change `memories` table on purpose, because a fresh database cannot expose this class
  of bug — and a test suite that only ever creates fresh databases will pass while every real upgrade
  breaks.

The cloud side has the same shape and its own script (`scripts/migrate-cloud-db.mjs`). Two stores,
two migration paths; forgetting either is the same mistake.

### A test double that is more convenient than reality tests the double

**What goes wrong.** `postgres.js` maps a `timestamptz` column to a JavaScript **`Date`**, and a
`text[]` column to a JavaScript **array**. The cloud pull cast both `as string` — a cast the
compiler accepts and reality does not — and better-sqlite3 refused the bind with *"SQLite3 can only
bind numbers, strings, bigints, buffers, and null"*. `team sync` failed against the real Railway
database while all 168 unit tests passed, because the suite's fake `sql` client hands back strings.

The second bug in the same path was invisible for the same reason: `searchSharedCache` bound the
whole query as ONE `LIKE '%entire string%'`, so a teammate's memory was pulled into the local cache
and still unfindable — "GS audit SafetyCore" does not occur as a contiguous substring of
"GS Audit Report completed for SafetyCore Pro".

- **Wrong:** `row['shared_at'] as string` on a Postgres row. A cast is an assertion, not a conversion.
- **Wrong:** a fake client that returns the shapes your code *wants*. It verifies your assumptions
  against themselves.
- **Right:** normalise at the boundary — `toIsoString` / `toTagsJson` in `src/shared/time.ts` — and
  verify the path against the real engine at least once (`scripts/verify-team-cloud.mjs`). Unit tests
  with a double are still worth having; they are not evidence that the integration works.

**The general rule:** for anything that crosses a driver boundary, ask what JavaScript type the
driver actually returns, and check it rather than assert it.
`node scripts/inspect-cloud-db.mjs` prints those types, and flags the ones SQLite cannot bind.

### An unrendered template placeholder in a shell script silently disables the gate

**What goes wrong.** A scaffolded hook script shipped with `MAX_LENGTH={{max_function_length |
default: 50}}` still in it. Bash does not fail on that — it tries to *run* `default:` as a command,
prints `command not found` to stderr, leaves `MAX_LENGTH` empty, and the later
`[ "$LEN" -gt "$MAX_LENGTH" ]` never fires. **The script exits 0.** Four hooks were affected, so the
function-length, file-length and two coverage gates had been passing without checking anything since
the day they were generated, while the dispatcher dutifully printed `ok`.

This is strictly worse than the same hole in prose. In a document an unrendered placeholder is
visible to a reader; in an executable gate it produces a green check over no check at all.

- **Wrong:** trusting a generated hook because it is present and exits 0.
- **Right:** `grep -rn '{{' .claude/hooks/` after any scaffold or refresh, and run each script once
  with `bash -n` (syntax) and once for real, watching **stderr**, not just the exit code.
- **Now enforced:** `scripts/gs-cascade-check.mjs` step 6 `gate-scripts-rendered` fails the build on
  any template hole under `.claude/hooks/` or `.githooks/`. The class is unreachable rather than
  merely documented.

**The general rule:** an exit code of 0 from a gate you have never seen fail is not evidence. Make it
fail on purpose once.

### tsconfig `rootDir` — including `tests/**` breaks the typecheck, not the build

**What goes wrong.** `rootDir: "src"` with `include: ["src/**/*", "tests/**/*"]` makes
`tsc --noEmit` exit with TS6059 for every test file. `tsup` still builds, so the break is
invisible until someone runs the typecheck gate.

- **Wrong:** one `tsconfig.json` serving both emit (needs `rootDir`/`outDir`) and
  typecheck (must see `tests/`).
- **Right:** `tsconfig.json` is the typecheck config — whole repo, `noEmit`, no `rootDir`.
  `tsconfig.build.json` extends it and adds `rootDir`/`outDir` for declaration emit.

### vitest coverage thresholds — configured is not enforced

**What goes wrong.** `vitest.config.ts` declares `coverage.thresholds.lines: 80`, but
thresholds are only evaluated when coverage is collected. `pnpm run test` does not pass
`--coverage`, so the 80% gate never ran despite being "configured".

- **Wrong:** a threshold in config plus a test script that omits `--coverage`.
- **Right:** the gate runs coverage in CI (`test:coverage`), and the threshold lives in
  the same place as the run that evaluates it.

### pnpm-workspace.yaml — a settings-only workspace file is a hard error on pnpm 9

**What goes wrong.** `pnpm-workspace.yaml` containing only `onlyBuiltDependencies` is
valid on pnpm 10 and fails on pnpm 9 with `ERROR packages field missing or empty`.

- **Wrong:** relying on `npx pnpm` (floating major) with a version-sensitive workspace file.
- **Right:** pin the package manager — `"packageManager": "pnpm@10.x"` in `package.json`
  — so every machine and CI runner resolves the same major.
