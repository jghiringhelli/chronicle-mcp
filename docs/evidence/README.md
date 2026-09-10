# Evidence

Execution records. Nothing else belongs here.

**The rule this directory exists to enforce.** No status may read "passing", "clean", "done" or
"✅" without a record here. Status is a function over evidence, never prose — a report that
*describes* a validation procedure which was never executed is worth zero, and a "done" that a
human assigned rather than computed does not count.

It exists because it was needed: `Status.md` claimed "Tests: 39/39 passing" and "Typecheck:
clean ✅" while the typecheck exited 2, the suite was 30/41, the coverage provider could not
load, the lint gate had no configuration, and the mutation gate did not exist.

## What a record must carry

- the exact command
- the exit code
- a timestamp
- the Node version and the tool's version
- for a benchmark: the machine, the seed, and the store size

A number without its conditions is not reproducible, and a result that cannot be reproduced is
an anecdote.

## Current records

All on Node 24.18.0, win32-x64, 2026-09-10.

| File | Gate | Result |
|---|---|---|
| `cascade-check-after.json` | `gs-cascade-check` | **0 errors**, 4 warnings |
| `typecheck.txt` | `tsc --noEmit` | **exit 0** |
| `lint.txt` | `eslint src tests` | **0 errors**, 32 waived warnings (exc-009) |
| `test-coverage.txt` | `vitest run --coverage` | **119 / 119 passed**, 41.17% lines |
| `mutation.txt` | `stryker run` | **MSI 20.67%** |
| `dependency-policy.txt` | `check-dependency-policy.mjs` | ok |
| `build.txt` | `tsup` | exit 0 |
| `mcp-smoke.json` | `smoke-mcp.mjs` — generative execution | **12 / 12 checks** |

### Kept as the "before" picture

| File | What it records |
|---|---|
| `cascade-check-baseline.json` | 13 errors, 14 warnings — the cascade before any of this |
| `test-run.txt` | 30 / 41 on `better-sqlite3@11` + Node 24: the native-binding failure that ADR-015 removed |
| `coverage-broken.txt` | `@vitest/coverage-v8@4` against `vitest@2` — why the 80% threshold had never once been evaluated |

These are deliberately not deleted. They are the evidence that the *before* claims were false, which
is what makes the *after* numbers worth anything.

## Missing, and tracked

- **Every NFR benchmark** (spec §5, NFR-02/03/04) — RM-104. The largest remaining gap.
- **`pnpm audit --prod --audit-level=high`** — the one gate that has never run.
- **Opening a v11-written database with v13** — ADR-015 is verified for new databases only.

Until those land, `Status.md` says *unrun* for them, which is the correct thing for it to say.
