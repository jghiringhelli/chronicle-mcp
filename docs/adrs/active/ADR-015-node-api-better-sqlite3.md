---
id: ADR-015
type: adr
status: active
tier: T1
properties: [executable, defended]
obligations: 4
depends_on: [ADR-001]
---

# ADR-015: Move to `better-sqlite3@13` (Node-API) instead of pinning a Node major

**Date:** 2026-09-10
**Status:** Accepted
**Amends:** the dependency-policy constraint added earlier the same day, and rule 7 of
`docs/dependency-policy.md`

## Context

The machine this project is developed on runs Node 24 and has no Visual Studio C++ toolchain and
no Node version manager. On `better-sqlite3@11.10`, that combination is fatal:

1. v11 publishes **per-ABI** prebuilds — one binary per Node major, named
   `better_sqlite3-v11.10.0-node-v137-win32-x64`. None exists for Node 24 (ABI 137).
2. With no prebuild, `install` falls through to `node-gyp rebuild`, which needs the C++ toolchain.
3. The package then installs "successfully" and every `new Database()` throws
   `Could not locate the bindings file` at runtime.

So 11 of 41 tests failed, the suite could not be trusted, `dist/` could not be exercised, and the
server could not be registered for use. The failure reads like a code bug and is not one.

The first response was to constrain the environment: `engines.node` was narrowed to `>=20 <24`, CI
pinned to Node 20, and the trap written up as a Known Pitfall. That is a correct *description* of
v11's limitation. It is the wrong *fix*, because it makes every consumer's Node version Chronicle's
problem — for a tool whose entire adoption story is `npx -y chronicle-mcp` with no configuration
(UC-008).

`better-sqlite3@13` changes the premise. It depends on `node-addon-api` and ships **Node-API**
prebuilds inside the npm tarball: `prebuilds/win32-x64.node`, `prebuilds/linux-x64.node`, and so on
— one binary per *platform*, with no Node version in the filename, because NAPI is ABI-stable
across Node majors.

## Decision

1. Depend on **`better-sqlite3@^13`**. The storage decision in ADR-001 (synchronous, embedded,
   single file, local-first) is unchanged; only the driver's packaging changes.
2. `engines.node` returns to the open range **`>=20`**. An open lower bound is now the *accurate*
   statement: a closed interval would refuse Node majors the dependency handles fine. (NAPI 8
   needs Node ≥18.17; ≥20 is required for other reasons.)
3. `better-sqlite3` MUST be kept **out of** pnpm's `onlyBuiltDependencies`. The package still
   carries a `binding.gyp`, and pnpm runs `node-gyp rebuild` by default for any approved package
   that has one — which re-creates the whole failure on a machine with no compiler, while the
   shipped binary sits unused beside it. This is the non-obvious half of the decision and the part
   a future session is most likely to undo while "fixing the install warning".
4. Rule 7 of `docs/dependency-policy.md` is amended rather than dropped: a **per-ABI** native
   dependency still requires a closed interval; a **Node-API** one requires an open lower bound.
   `scripts/check-dependency-policy.mjs` encodes both cases and names which packages are which.

## Alternatives Considered

- **Pin Node to 20 and keep `better-sqlite3@11`.** Rejected as the primary fix. It works, and CI
  still pins a Node version for reproducibility, but as a *product* constraint it pushes the cost
  onto every consumer and breaks on the next Node major anyway. It solves today's machine, not the
  class of problem.
- **Install the Visual Studio C++ build tools on this machine.** Rejected: a multi-gigabyte local
  workaround that fixes one developer's laptop and nothing about the published package. A consumer
  running `npx -y chronicle-mcp` on Node 24 would still fail.
- **`better-sqlite3@^12`.** Also carries NAPI prebuilds from 12.2, so it would work. Rejected only
  on recency — 13 is current and the migration cost is identical.
- **Switch to `node:sqlite` (the built-in).** Tempting: zero dependencies, synchronous, no native
  build at all. Rejected for now — it is still marked experimental, its API differs from
  better-sqlite3 in ways that touch every repository, and doing it during a compliance pass would
  mean rewriting the one well-tested adapter. Worth its own ADR once it stabilises; record the
  option rather than lose it.
- **Ship prebuilds ourselves / vendor the binary.** Rejected: takes on a release-engineering
  burden the upstream package already carries correctly.

## Consequences

**Positive.** The install works on this machine with no compiler and no version manager: 41/41
tests went green on Node 24 immediately after the change, and `dist/cli.js` could then be built and
registered as a user-scope MCP server. No Node-major pin is needed in the product. Future Node
majors keep working without a release.

**Negative.** A major bump of the storage driver — the single most load-bearing dependency in the
system — made without a migration test against a pre-existing database file. SQLite's file format
is stable and v13 is API-compatible for everything this code uses, but "the format is stable" is an
argument, not evidence: an existing `~/.chronicle/chronicle.db` written by v11 has not been opened
by v13 under test. Recorded as a treatment item, not waved away.

The `onlyBuiltDependencies` omission produces a pnpm warning on every install
(`Ignored build scripts: better-sqlite3`). That warning is the desired state, which is
counter-intuitive enough that `pnpm-workspace.yaml` carries a comment saying so, and this ADR is
what it points at.

## Verification

- `tests/unit/adapters/sqlite-memory-repository.test.ts` — 11 tests against a real database,
  green on Node 24 with v13 (they were the 11 failures under v11).
- `tests/unit/infrastructure/database-concurrency.test.ts` — pins the pragma contract on a real
  file database (ADR-016).
- `scripts/smoke-mcp.mjs` — 12/12 against the built server, so the binary loads in the shipped
  artifact and not only under the test runner.
- `docs/evidence/` holds the runs.
- **Missing:** opening a v11-written database file with v13. Until that exists, the upgrade is
  verified for new databases only.
