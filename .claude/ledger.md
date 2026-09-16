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
>
> Because it is always loaded it also has a read budget — 300 lines, enforced by
> `scripts/gs-cascade-check.mjs` step 1. Append-only and bounded are both real
> constraints, so when it fills, the oldest entries move to
> `.claude/ledger-archive.md`. Moved, never dropped: an archived lesson binds exactly
> as much as one here.

---

## Corrections Log

Behavioural deviations that were corrected once and must not recur. One dated line each.
When the user says *"don't do that"* about a pattern produced here, append a line.


> Entries before 2026-09-12 live in `.claude/ledger-archive.md` — moved, not deleted, so this node
> stays inside its read budget. They bind exactly as much as the ones below.

- `[2026-09-13]` — One reading is not a measurement, and a median is not one either when there is a
  warm-up curve. The benchmark sampled NFR-03 thirty times and NFR-02/NFR-04 **once**, and that
  inconsistency decided verdicts: ten cold starts gave 349…220ms and five decay passes gave
  573…234ms, both monotonic warm-ups rather than noise. The `251ms` and `363ms` recorded as *verified*
  in ADR-021 and spec §5 were whichever point of the curve the run happened to land on — and the decay
  pass actually takes ~600ms cold on this host, over its 500ms budget. Cold and steady are now
  reported separately, and the verdict is judged on cold, because that is the user's situation.
- `[2026-09-16]` — When you fix the mechanism, re-read the test. The acceptance check asserted that
  an app role *cannot re-point `chronicle.user_id`*. After ADR-024 the policy stopped reading that
  variable, so the assertion became true-but-irrelevant and still failed — it was testing the
  mechanism, not the property. Rewritten to make the claim as loudly as possible and then verify it
  buys nothing: read 0 rows, update 0 rows, insert refused.
- `[2026-09-16]` — A suite that only passes has not shown it can fail. Every isolation check went
  green after the fix, which is precisely the position the suite was in at 12/12 while the hole was
  open. It now builds a throwaway table with the OLD vulnerable policy and replays the same lie
  against it: the lie works there and not on the real tables, so the pass is the policy holding
  rather than the check having stopped looking.
- `[2026-09-16]` — A security fix changes who your tools are allowed to be. `verify-cloud-sync`
  wrote under a throwaway `zz-verify-<ts>` id, which an RLS-confined role may not do — the whole
  verification would have failed for a reason unrelated to what it verifies. It now asks
  `chronicle_role_map` who the connected role is entitled to be, so the same script works whether it
  is handed an app credential or an admin one.
- `[2026-09-16]` — Privileges and ownership are different things, and GRANT cannot bridge them.
  `CREATE POLICY` and `ALTER TABLE … FORCE ROW LEVEL SECURITY` are owner-only; no grant confers
  them. I had recorded in ADR-024 that granting `CREATE ON SCHEMA public` would make the next run the
  last one needing Railway's credential — wrong, because the six person tables are owned by
  `postgres`. The privileged run now also re-owns them to the `chronicle_admins` group, which is what
  actually makes the claim true.
- `[2026-09-16]` — A provisioning script must check it *can* provision before it starts. `--apply`
  ran several GRANTs and then died halfway on `permission denied for schema public`, leaving a state
  nobody designed. It now opens with a catalogue-only preflight that names every missing privilege
  and ownership at once, and exits before touching anything. The first failure told me one blocker;
  the preflight told me there were two.
- - `[2026-09-14]` — A transformation is not a mapping. The RLS fix was going to derive the user id by
  parsing it back out of the role name — but `roleName()` sanitises `@` and `.` to `_` to satisfy
  Postgres, and that is one-way. It works for `gabo` and `jghiringhelli` and silently matches nothing
  for the first id containing a dot, which presents as a Chronicle that has forgotten everything. It
  works for exactly the data present when it is written, which is the definition of a latent bug.
- `[2026-09-14]` — A script that re-issues credentials on every run is a trap. `apply-rls.mjs` did
  `ALTER ROLE … PASSWORD` unconditionally, so applying an unrelated policy change would have
  invalidated every credential already handed out, including a partner's. Rotation is now `--rotate`.
- `[2026-09-14]` — A control tested only against a cooperating client has not been tested. The RLS
  suite reported 12/12: one app role could not read, update, delete or forge another person's rows.
  Every check drove the mechanism *as designed*; none tried to disregard it. The policy filters on
  `current_setting('chronicle.user_id')`, pinned with `ALTER ROLE … SET` — which is a DEFAULT, and a
  custom GUC carries no privilege, so a session just re-points it and all four blocked operations
  succeed. Ask what the control does against a client that misbehaves, because that is the only
  client it exists for.
- `[2026-09-14]` — A confident number on an untested property is worse than no number. `12/12` in
  `isolation-verify.json` is what made the gap invisible for three days: nobody re-reads a suite that
  is passing. It now reads 12/13 and stays red until the policy binds rows to `current_user` instead
  of to a claim.
- `[2026-09-14]` — Classify a credential by what it can reach, not by its name. `chronicle_app_*`
  sounds like a step down from `chronicle_admin_*` and is not one: either grants full access to both
  people's rows. That is the whole reason there is no CI secret — a green `cloud-verify` job would
  have cost a partner's data.
- `[2026-09-13]` — Do not fit a model to one machine's data. Having replaced a single reading with a
  sample, I read the win32 series (349, 345, 280, 210…) as a warm-up curve, reported cold-versus-steady
  and judged on cold. The same code on the CI runner gave 791, 415, 207, 553, 302 — not a curve, just a
  noisy shared host — so "cold" and "steady" were labels for interference. The verdict is now the
  median, which is robust in both regimes, and the record carries a `warmupMonotonic` flag so a reader
  can tell which regime a number came from. Three iterations of the same lesson in one session: one
  sample, then a mislabelled p95, then a model that only held on one host.
- `[2026-09-13]` — A shared CI runner measures throughput, not latency. It reported the decay pass
  anywhere in 207–791ms and a recall p95 an order of magnitude worse at 1,000 memories than at 10,000.
  Useful for "did it run", useless for "is 500ms met" — which is why the `benchmark` job does not gate,
  and why its numbers are recorded as informational. I had already quoted two of them as verdicts
  before looking at their spread.
- `[2026-09-13]` — Do not print a `p95` you cannot resolve. At n=5 or n=10 the nearest-rank p95 *is*
  the maximum, so labelling it p95 overstates the sample. I shipped exactly that for one iteration
  before noticing the p95 and the max were always equal.
- `[2026-09-13]` — A gate's target must be the spec's target. `bench-nfr.mjs` still checked NFR-02
  against the 200ms that ADR-021 superseded, so CI printed `MISSES` against a budget the spec no
  longer contains. A gate that disagrees with the document it gates is worse than no gate, because
  its output looks authoritative. The number is now one constant, cited to the spec section.
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
