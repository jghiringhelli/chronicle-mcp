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

All on Node 24.18.0, win32-x64. Dated per row, because they stopped being one session's output:
this table said *2026-09-10* above eight rows for two months while four of them had moved.

| File | Gate | Result |
|---|---|---|
| `cascade-check-after.json` | `gs-cascade-check` | **0 errors**, 4 warnings · 2026-09-10 |
| `typecheck.txt` | `tsc --noEmit` | **exit 0** · 2026-09-10 |
| `lint.txt` | `eslint .` — one scope now, where two had drifted | **0 errors**, 54 waived warnings (exc-009) · 2026-11-10 |
| `test-coverage.txt` | `vitest run --coverage` | **420 / 420 passed**, **63.79% lines** · 2026-11-12 |
| `mutation.txt` | `stryker run` | **MSI 36.92%** · 2026-09-13 |
| `dependency-policy.txt` | `check-dependency-policy.mjs` | ok · 2026-09-10 |
| `build.txt` | `tsup` | exit 0 · 2026-09-10 |
| `mcp-smoke.json` | `smoke-mcp.mjs` — generative execution | **22 / 22 checks** · 2026-11-10 |
| `nfr-bench.json` | `bench-nfr.mjs --full` — the only record here that **fails** | NFR-03 p95 **30ms** at 10k ✔ · NFR-04 median **315ms** at 50k ✔ · NFR-02 median **447ms** against 300 ✘ (RM-109) · 2026-11-12 |

### Experiments — quality, not pass/fail

A gate answers *did it run*. These answer *is it any good*, which no gate here could:

| File | Experiment | Result |
|---|---|---|
| `recall-experiment.json` | `pnpm run experiment:recall` — 51 memories, 35 labelled queries | keyword-legacy **MRR 0.26 / R@5 0.42** → shipped **0.76 / 0.83**; vectors-only 0.73 / 0.72; hybrid 0.80 / 0.79 |
| `dedup-experiment.json` | `pnpm run experiment:dedup` — 32 labelled pairs, a 51-memory pool, and 48 reversed/restated decisions | the shipped thresholds once gave **F1 0.00 for both methods**; now **0.63** by default and **0.78** with a model, with **0** contradictions merged. The guard catches **36/48** reversals (negation alone caught 29) |
| `nfr-bench-2026-11-10-ranking.json` | `bench-nfr.mjs`, re-run after the ranking change | NFR-03 **p95 16.93ms at 10k** (budget 50ms). NFR-02 median 326.67ms, inside this host's known 210–372ms band |
| `nfr-bench.json` | `bench-nfr.mjs --full`, 2026-11-12 — the current record, and the one that fails | NFR-03 p95 **30ms at 10k** ✔, **51ms at 50k** beyond the specified size. NFR-04 median **315ms at 50k** ✔, first pass 554ms. NFR-02 median **447ms** against 300 ✘ — **outside** the 210–372ms band, with Node + the MCP SDK alone measuring ~265ms where ADR-021 had ~165ms (RM-109) |

Method and limits in `experiments/README.md`. Both are reproducible with no credentials, no
network and no model download, and the committed baselines make a later regression fail the run.
`nfr-bench.json` is what `bench-nfr.mjs` writes, so only a `--full` run may be allowed to land on
it — a shorter run would silently delete the 50,000-row NFR-04 reading that spec §5 cites. The
2026-11-12 run was `--full` and replaced it legitimately; the 2026-11-10 ranking re-run was not,
which is why it was kept under its own name instead. The September `--full` record survives as
`nfr-bench-win32-dev.json`, which holds the same readings as the `nfr-bench.json` it was copied
from — identical once parsed, differing only in line endings, which is checkable rather than
asserted.

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
- **Opening a v11-written database with v13** — ADR-015 is verified for new databases only.

Items struck here rather than deleted, because an index that quietly drops what it once called
missing cannot be checked against itself:

- **The NFR benchmarks** landed 2026-09-13 (`nfr-bench*.json`, RM-104 closed), and were re-run
  2026-11-12 after the ranker. `Status.md`, `docs/roadmap.md` and `docs/gs-assessment.md` all went
  on calling them unmeasured for two months while this file recorded them as closed — the
  repository contradicted itself in writing, which is exactly what the GS audit of 2026-10-27
  found in `Status.md`'s gate table.
- **The supply-chain audit** has run since 2026-09-14 (`supply-chain-audit.txt`).
- **Whether a real embedding model closes the paraphrase gap.** It does, and it was the one open
  question here whose answer changed a decision: 0.42 → **0.75** on that query class, MRR 0.76 →
  **0.86** overall, at **144–151ms** per query against NFR-03's 50ms budget. So it is adopted for
  promote-time de-duplication, which has no budget, and refused as the recall default (ADR-028 §2).
  `fastembed` is a devDependency; the measurement is in `recall-experiment.json`.

For anything still on the list above, `Status.md` says *unrun*, which is the correct thing for it
to say.
