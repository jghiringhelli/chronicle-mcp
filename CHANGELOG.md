# Changelog

All notable changes to chronicle-mcp are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/).

A `CHANGELOG` that exists only as "we will add one" is not Auditable
(`.claude/standards/spec.md`). This file was written on 2026-09-10, back-filled from the commit
history; entries before that date are reconstructed and may be incomplete in detail, though the
commits they cite are exact.

## [0.5.0] — 2026-09-14

**Breaking: the minimum supported Node is now 22.** `better-sqlite3@13` requires it, and on Node 20
its prebuilt binding does not fail to load — it segfaults (ADR-022). Node 20 reached end of life on
2026-04-30.


### Changed — BREAKING

- **The minimum supported Node is now 22** (`engines.node: ">=22"`, previously `>=20`). Required, not
  chosen: `better-sqlite3@13` declares `>=22`, and on Node 20 its prebuilt binding does not fail to
  load — it **segfaults**, exit 139, no stack, no message. Node 20 reached end of life on
  2026-04-30. **ADR-022**.

### Fixed — defects found by running things

- **`engines.node` promised a runtime that segfaults.** Found by the Node matrix on this branch's
  first CI run: Node 24 green, Node 20 `Segmentation fault (core dumped)`. `better-sqlite3` raised
  its own floor from `20.x||22.x||23.x||24.x` (`@12`) to `>=22` (`@13`) and this package kept
  claiming `>=20`; npm and pnpm treat an engine mismatch as a warning, so it installed cleanly and
  then crashed. Three-part fix, because each part covers a different escape route:
  - `engines.node` raised to `>=22` and the CI matrix moved to `['22', '24']` — a matrix that omits
    the floor is not testing the claim, which is how `>=20` survived until the day 20 was in it.
  - **dependency-policy rule 9**: the `engines.node` floor must be at or above every runtime
    dependency's own floor, gated by `scripts/check-dependency-policy.mjs` against the installed
    tree. Rule 7 already governed the *shape* of the range and passed this — `>=20` was the right
    shape and the wrong number. Verified by reverting the defect and watching the gate exit 1.
  - a **runtime guard** (`src/shared/runtime.ts`, `src/shared/assert-runtime.ts`): an unsupported
    Node now gets four lines naming the version, the cause and the remedy, on stderr — stdout is the
    MCP transport. `engines` cannot do this; it is advisory, and `npx` or a global install skips it.
  `cli.ts` now reaches the native code via `await import('./mcp/server.js')`, so the guard running
  first is guaranteed by the language rather than by its import line staying above the others.

### Fixed — defects found by running things

- **`session(action: 'end', project)` ignored `project`** and called `endSession(args.id ?? '')`, so
  the documented F7 flow — start with a project, end with the same project — failed with
  `Session not found:` and an empty id. `recover` had the project fallback; `end` never did. Found by
  `scripts/smoke-mcp.mjs` driving the real MCP boundary, **not** by 119 green unit tests. Regression
  test in `tests/unit/services/session-service.test.ts`.
- **The install was broken on Node 24.** `better-sqlite3@11` publishes per-ABI prebuilds with none
  for Node 24, so `install` fell through to `node-gyp` and, with no C++ toolchain, every
  `new Database()` threw `Could not locate the bindings file` at runtime — 11 of 41 tests failing in
  a way that read like a code bug. Moved to `better-sqlite3@^13`, which ships **Node-API** binaries:
  one ABI-stable binary per platform, no compiler, no Node pin (**ADR-015**). 41/41 immediately, and
  `engines.node` returned to `>=20` — *which was wrong, and is corrected below: `@13` requires Node
  `>=22`, and on Node 20 its binding segfaults. See **ADR-022**.*
- **`better-sqlite3` removed from pnpm's `onlyBuiltDependencies`.** It still carries a `binding.gyp`,
  and pnpm rebuilds any approved package that has one — re-creating the whole failure while the
  shipped binary sat unused beside it. The resulting `Ignored build scripts` warning is the desired
  state, which is counter-intuitive enough that `pnpm-workspace.yaml` says so.
- **Stryker could not load its test runner** under pnpm's strict layout; `plugins` now declares
  `@stryker-mutator/vitest-runner` explicitly.
- Five `as any` casts in `src/dashboard/server.ts` replaced with a `DbRow` alias and a typed
  projection row; `catch (err: any)` replaced with an `instanceof Error` narrowing.

### Added — verification that executes

- **`scripts/smoke-mcp.mjs`** (`pnpm run smoke`) — generative execution: drives the **built** server
  as a real MCP client over stdio. Twelve checks covering the three-tool surface (ADR-011), UC-001's
  round trip, UC-008's zero-configuration start, the session lifecycle, `axon` answering without a
  team, and **two concurrent server processes on one database** (ADR-016). Writes
  `docs/evidence/mcp-smoke.json`. Wired into CI as its own job.
- **78 tests**, taking the suite from 41 to **119**: `coordination-service` 45 (771 lines, from zero —
  the ranking algorithm on a linear chain, a diamond, disconnected components and a **cycle**, plus
  the availability invariant, branch derivation, downstream promotion and the merge-gate
  authorisation rule), `sync` 15 (522 lines, from zero — the five EDR-003 contracts),
  `session-service` 11, `database-concurrency` 7.
- **`applyConcurrencyPragmas()`** extracted, exported and tested — the multi-instance contract
  (**ADR-016**) is now pinned rather than incidental. Nothing had tested it, so the pragma line could
  have been deleted as startup noise with every gate still green.
- `server.json` at the repository root for the MCP Registry (spec NFR-08), against the current schema.
- `docs/install-mcp.md` — registering Chronicle at **user scope** so every AI session on a machine
  shares one memory store, what happens with several instances at once, and troubleshooting.
- CI: a **Node 20/24 matrix** (so `engines: >=20` is tested rather than asserted), a native-binding
  load check, and the `generative-execution` job.
- **ADR-015** (Node-API driver) and **ADR-016** (multi-instance concurrency as a supported contract,
  amending ADR-001's "no concurrent write access").

### Changed — thresholds became ratchets

- **The coverage and mutation gates now run, and their thresholds are floors at the measured values**:
  41% lines, 20% MSI. Both had been declared for months — 80% and 65% — and **neither had ever been
  evaluated**; the first real measurements were 15.24% and 9.14%. A threshold nobody can pass is a
  disabled gate; a floor at the measured value blocks regressions from today forward. The 80/65
  targets stay on record in `.claude/standards/testing.md`.
- **Dependency policy rule 7 amended** rather than dropped: a per-ABI native dependency still needs a
  closed `engines` interval; a Node-API one needs an open lower bound, because a closed interval would
  refuse Node majors the dependency handles fine. `scripts/check-dependency-policy.mjs` encodes both.
- All nine `.forgecraft/exceptions.json` entries now carry `expiresAt` and a `reviewNote`. An
  exemption without an expiry is a bypass, not a waiver.
- A scoped, expiring lint waiver (`exc-009`) for the 33 `as any[]` SQL casts in the two SQL-heavy
  services — `warn` there, `error` everywhere else. The rule is right; retyping 1,300 uncovered lines
  before characterising them was the wrong order.

### Added
- **Harness, emitted rather than described.** `.github/workflows/ci.yml` (cascade, typecheck,
  lint, coverage, mutation, supply chain, build) and `.githooks/{pre-commit,commit-msg}`
  dispatchers. Fourteen hook scripts had sat in `.claude/hooks/` since March with nothing
  invoking them; `pnpm run hooks:install` now wires them.
- `scripts/gs-cascade-check.mjs` — the five-step GS cascade as machine-evaluable predicates:
  sentinel-category coverage, route resolution, read budgets, ADR index symmetry in both
  directions, stub detection in required cascade slots, frontmatter schema. Dependency-free.
  Baseline 13 errors → 0.
- `eslint.config.js` — `import/no-cycle` plus `no-restricted-imports` layer boundaries (domain
  sealed, services barred from adapters). `pnpm run lint` previously had **no configuration at
  all** and could never have passed.
- `stryker.config.json` — the mutation gate `.claude/standards/testing.md` has mandated since
  March (MSI ≥65% overall, ≥70% changed). Not yet executed.
- `docs/dependency-policy.md` + `scripts/check-dependency-policy.mjs` — approved/forbidden
  libraries and eight normative rules, gated in CI. Supply-chain safety is orthogonal to the
  seven structural properties, so it is specified separately.
- **Decision layer.** ADR-010 (team fold), ADR-011 (three consolidated MCP tools), ADR-012 (six
  memory types) as back-fills with commit-level provenance; ADR-013 (single authoritative spec),
  ADR-014 (recall is keyword-first — recording that ADR-001's search decision was never built).
  New EDR layer at `docs/edrs/`: EDR-001…004 for the four load-bearing units.
- **Sentinel tree completion.** `.claude/standards/tool-sequencing.md` — the fifth GS category,
  previously absent. `.claude/ledger.md` — Corrections Log and Known Pitfalls with real content,
  replacing the `### [Add project-specific pitfalls here]` stubs.
- `docs/evidence/` — execution records. No status claim may exist without one.
- `docs/gs-assessment.md` — seven-property score with the anchor named per property, and a
  tier-ordered treatment plan.
- `CHANGELOG.md`, this file.
- UC-009 — a behavioural contract for the `axon` team layer, which had shipped with none.
- `tsconfig.build.json`, so emit and typecheck stop fighting over `rootDir`.

### Fixed
- **`pnpm run typecheck` now passes.** It exited 2 with TS6059 on all four test files:
  `rootDir: "src"` with `tests/**` in `include`. Split into a typecheck config and a build config.
- **`pnpm run test:coverage` can load its provider.** `@vitest/coverage-v8@4` against
  `vitest@2` throws on a missing `BaseCoverageProvider` export, so the 80%-line threshold
  declared in `vitest.config.ts` had **never been evaluated**. Pinned to `^2.1.9`.
- `engines.node` narrowed from `>=20` to `>=20 <24`: `better-sqlite3@11` publishes no Node 24
  prebuild, so the old range promised support that did not exist.
- `packageManager` pinned to `pnpm@10`, because `pnpm-workspace.yaml` without a `packages:` key
  is a hard error on pnpm 9.
- Two unused imports in `tests/unit/services/memory-service.test.ts`.

### Changed — documentation corrected against the code
- `docs/spec.md §6` no longer lists cloud sync, team memory and the dashboard as out of scope;
  all three shipped. §0 now carries an explicit intent statement and a *true* scope boundary.
- `docs/spec.md §5` NFRs are RFC-2119 normative with a verification status each. All ten read
  *unrun*, *at risk* or *not met* — the first honest statement of that fact.
- `docs/spec.md §4` marks every feature [SHIPPED] / [PARTIAL] / [SPECIFIED], and names the real
  three-tool surface: the F-sections were written against ~25 flat tools that do not exist.
- `docs/use-cases.md` rewritten to the real surface, with a status line per UC. UC-001 had
  asserted `tier: "buffer"` for a `semantic` memory; the code seeds `working`.
- `docs/PRD.md` and `docs/TechSpec.md` were unfilled scaffold templates occupying required
  cascade slots. Both filled.
- `docs/chronicle-spec.md` marked `status: superseded` with a divergence banner (ADR-013).
- `docs/roadmap.md` replaced: items read "Implement UC-001: Implement primary use case" and
  pointed at eight prompt files that never existed. RM-001…003 deleted; RM-101…105 written as
  bound prompts with explicit NOT-IN-SCOPE lines.
- `README.md` decay/tier table corrected against `DECAY_RATES`/`DEFAULT_TIERS` (`semantic` starts
  in working, `insight` never decays and starts in core); examples use the real tool shapes.
- `.claude/core.md` rewritten — it was truncated mid-sentence and held a pasted YAML block.
- `.claude/standards/architecture.md` identity fields `{{framework}}` and `{{domain}}` filled;
  the cascade check now fails on any unresolved template hole.
- `src/domain/types.ts` header said "five-memory model" above a six-member union.
- `Status.md` rewritten as derived status. It had claimed "Tests: 39/39 passing" and "Typecheck:
  clean ✅" while the typecheck exited 2 and the suite was 30/41.
- `forgecraft.yaml`: `adrs` and `architecture_diagrams` promoted from optional to required, each
  with the reason and date.

## [0.4.0] — 2026-09

Published to npm without a changelog entry; this note is back-filled on 2026-09-14 from the commit
history and is deliberately brief, because a reconstructed record should not read like a written one.
The substance of this release — the team knowledge layer folded into core, the three memory scopes,
and the cloud mirror — is documented in ADR-002 and ADR-018 through ADR-021, which were written at
the time.

## [0.3.2] — 2026-08

### Added
- Agent-instructive MCP tool descriptions: the description tells the agent *when* to call an
  action, not only what it does (`1e31dd2`).

### Changed
- Memory-model wording corrected to six types (`8595357`).

## [0.3.1] — 2026-07

### Added
- Library-mode entrypoint with project-scoped instance support (`3432773`).
- ForgeCraft gates and Claude standards synced (`66442b3`).

## [0.3.0] — 2026-07

### Added
- **`axon`** team coordination tool: contributors, work-package decomposition with
  reverse-topological ranking, assignment, merge gating (`dca49ba`) — see ADR-010.
- Token generation and Railway validation (`38e0796`).
- `userId` auto-detected from `git user.email` on first run (`356b5fc`).

### Changed
- Team code had been split into a separate `chronicle-team` package (`f81f43f`) and was folded
  back in here. Neither direction was recorded at the time; ADR-010 is the back-filled record.

## [0.2.0] — 2026-06

### Added
- Public API exports extended (`3e2c9bb`).
- Chronicle Team plus the three-tool consolidation (`c69bc71`) — see ADR-011.

### Changed
- **Breaking (persisted values):** memory type `session` renamed to `insight`; `confirmed: true`
  now forces Core tier and zero decay (`b083525`). No migration shipped for rows carrying
  `memory_type = 'session'`; still outstanding (ADR-012 §2, RM-403).

## [0.1.0] — 2026-04

### Added
- First public release: six memory types, three tiers, weight/reinforcement/decay, triggers,
  preferences, session continuity, optional Railway Postgres mirror, local dashboard.
- Exception hierarchy, first unit tests, `noUncheckedIndexedAccess`, config module — the four
  p5-review blockers (`docs/review-verdict.md`).
