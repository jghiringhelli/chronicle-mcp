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

### Experiments — quality, not pass/fail

A gate answers *did it run*. These answer *is it any good*, which no gate here could:

| File | Experiment | Result |
|---|---|---|
| `recall-experiment.json` | `pnpm run experiment:recall` — 51 memories, 35 labelled queries | keyword-legacy **MRR 0.26 / R@5 0.42** → shipped **0.76 / 0.83**; vectors-only 0.73 / 0.72; hybrid 0.80 / 0.79 |
| `dedup-experiment.json` | `pnpm run experiment:dedup` — 32 labelled pairs, a 51-memory pool, and 48 reversed/restated decisions | the shipped thresholds once gave **F1 0.00 for both methods**; now **0.63** by default and **0.78** with a model, with **0** contradictions merged. The guard catches **36/48** reversals (negation alone caught 29) |
| `nfr-bench-2026-11-10-ranking.json` | `bench-nfr.mjs`, re-run after the ranking change | NFR-03 **p95 16.93ms at 10k** (budget 50ms). NFR-02 median 326.67ms, inside this host's known 210–372ms band |

Method and limits in `experiments/README.md`. Both are reproducible with no credentials, no
network and no model download, and the committed baselines make a later regression fail the run.
`nfr-bench.json` is **not** overwritten by that re-run: it holds the `--full` measurement that
spec §5 cites for NFR-04 at 50,000 rows, which a shorter run would have silently deleted.

### Kept as the "before" picture

| File | What it records |
|---|---|
| `cascade-check-baseline.json` | 13 errors, 14 warnings — the cascade before any of this |
| `test-run.txt` | 30 / 41 on `better-sqlite3@11` + Node 24: the native-binding failure that ADR-015 removed |
| `coverage-broken.txt` | `@vitest/coverage-v8@4` against `vitest@2` — why the 80% threshold had never once been evaluated |

These are deliberately not deleted. They are the evidence that the *before* claims were false, which
is what makes the *after* numbers worth anything.

## Missing, and tracked

- **Recall quality at scale.** The labelled corpus is 51 memories. Latency at 10k is measured;
  whether MRR holds when there are ten thousand candidates is not, and more memories means more
  plausible-but-wrong neighbours.
- **Whether a real embedding model closes the paraphrase gap.** Three labelled queries that
  genuinely need synonymy fail in *every* configuration measured (ADR-027). A
  sentence-transformer is the obvious candidate and none has been run.
- **Opening a v11-written database with v13** — ADR-015 is verified for new databases only.

Two items were on this list until they were not, and are struck here rather than deleted:
**the NFR benchmarks** landed 2026-09-13 (`nfr-bench*.json`, RM-104 closed) and **the supply-chain
audit** has run since 2026-09-14 (`supply-chain-audit.txt`). Leaving them listed as missing while
the files sat in this directory made the index say something false about its own contents.

Until those land, `Status.md` says *unrun* for them, which is the correct thing for it to say.
