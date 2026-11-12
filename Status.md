---
id: STATUS
type: status
status: active
tier: T1
properties: [auditable, verifiable]
obligations: 2
generative_execution: red
depends_on: [SPEC, GS-ASSESSMENT]
---

# Status — chronicle

**Last updated:** 2026-10-27 · **Version:** 0.4.0 · **Branch:** `pilot/companion-2026-10`

> **How to read this file.** Every line is either a **measurement** citing a record under
> `docs/evidence/`, or an explicit **unrun**. No line may say "passing", "clean" or "✅"
> without a record — status is a function over evidence, never prose (Corrections Log,
> 2026-09-10). The previous version of this file claimed "Tests: 39/39 passing" and
> "Typecheck: clean" while the typecheck exited 2 and the suite was 30/41. That is the failure
> this format exists to prevent, and it is why the format is stated before the status.

---

## Current Phase

**Phase: brownfield adoption, GS step `06-harness`.** Steps 01 and 02 are closed and verified by
`gs status`; steps 03 to 05 report lacks that `gs step` is the sanctioned route through, and the
step-03 collision under **Brownfield Baseline** below still stands. The product phase is
unchanged: v0.4.0 feature-complete for the shipped surface, v0.5.0 prepared and unpublished.

Since 2026-11-10 recall has a measured quality floor as well as a latency one — see
**Recall quality** below. That was the first instrument in this repository for whether the
product's central claim is true, as opposed to whether its code runs.

## Brownfield Baseline

GS Audit overall grade from Step 02: **B- (SAVED), engineering layer C+**, measured 2026-10-27
against commit `45b68e2` and recorded in `reports/gs-audit-2026-10-27.md`.

Property grades: Self-describing B+ · Auditable B · Verifiable C+ · Executable B · Defended B ·
Bounded C · Composable B+. The audit's three priorities, in its order of leverage: declare the
size limits where an instrument can read them, close the `prepublishOnly` advisory hole, give the
integration layer a home. Its fifteen-item remediation plan is the contract for the sessions that
follow, and the items are not repeated here.

**Step 03 is blocked, deliberately.** The harness asks for `docs/spec/SPEC.md`; this repository's
authoritative spec is `docs/spec.md` and ADR-013 makes it the single source. Writing a second
specification document to satisfy a path would break the rule the step exists to serve, so it has
not been written. The sanctioned way out is `gs step --lock adopt`, which is gated behind step 06
and therefore unreachable from here. Recorded as friction in
`reports/gs-companion-feedback-2026-10-27.md`.

## Last Session

**2026-10-27 — the GS audit, and the first two brownfield steps closed.** Ran the gs-companion
plugin (2.0.0-beta.9) against this repository as a real user rather than a demo. `gs status` moved
chronicle from `01-cold-read` through `02-gs-audit` to `03-spec-from-code`, and step 02 is verified:
68 structural fields present and 43 citations checked against the files. The audit it commissioned
is `reports/gs-audit-2026-10-27.md` — B- overall, with the three findings that were not already
written down anywhere: this file's gate table disagreeing with its own evidence, no size limit
declared where any instrument can read it, and `prepublishOnly` never running `pnpm audit`. ADR-025
was needed before the audit could even be committed, because `.gitignore` classified it as gate
output. Nine of the plugin's fifteen instruments reported `not measured` against a repository that
has them all installed; the two pnpm/Windows causes are diagnosed in
`reports/gs-companion-feedback-2026-10-27.md`, which is the other product of the session.

The session log below keeps the earlier entries, newest first.

---

## Gates — measured

Every gate runs. **One does not pass:** `pnpm run bench` exits 1 because NFR-02 misses its budget,
and it is in the table rather than described as "not a gate" — the script has always set a failing
exit code on a miss, so calling it anything else would be a choice about wording, not a fact. Rows
dated 2026-09-10 unless stated; Node 24.18.0, win32-x64.

| Gate | Command | Result | Record |
|---|---|---|---|
| Cascade / sentinel | `pnpm run cascade` | **0 errors, 4 warnings** | `docs/evidence/cascade-check-after.json` |
| Typecheck | `pnpm run typecheck` | **exit 0** | `docs/evidence/typecheck.txt` |
| Lint (cycles + layers) | `pnpm run lint` | **0 errors**, 54 warnings (exc-009) · scope is now `eslint .`, one list instead of two that had drifted | `docs/evidence/lint.txt` |
| Tests | `vitest run` (pre-commit) | **420 passed / 420**, 2026-11-10 | this table's own run record |
| Coverage | `pnpm run test:coverage` | **63.79% lines**, 2026-11-12 (floor raised 59 → **63**, target 80) | `docs/evidence/test-coverage.txt` |
| Mutation | `pnpm run test:mutation` | **MSI 40.81%**, 2026-11-12 over 3,372 mutants (floor raised 36 → **40**, target 65) | `docs/evidence/mutation.txt` |
| Dependency policy | `pnpm run deps:policy` | **ok** | `docs/evidence/dependency-policy.txt` |
| Build | `pnpm run build` | **exit 0** | `docs/evidence/build.txt` |
| **MCP generative execution** | `pnpm run smoke` | **22 / 22 checks** | `docs/evidence/mcp-smoke.json` |
| **Latency NFRs** | `pnpm run bench` | NFR-03 **p95 30ms at 10k** (budget 50) ✔ · NFR-04 **median 315ms at 50k** (budget 500) ✔ · NFR-02 **median 447ms** (budget 300) ✘ — 2026-11-12, win32 dev host | `docs/evidence/nfr-bench.json` |
| Supply chain | `pnpm audit --prod --audit-level=high` | **exit 0**, 3 advisories allow-listed, 2026-10-26 | `package.json` `auditConfig.ignoreGhsas` |

### Recall quality — measured, not gated

A gate answers *did it run*. Until 2026-11-10 nothing answered *does recall find the right
memory*, which is the question the product exists to answer. It now has an instrument
(`experiments/`, method copied from CodeSeeker's `tests/relevance/`), 51 memories and 35
hand-labelled queries:

| Configuration | MRR | recall@5 | cases passed | out-of-scope answered |
|---|---|---|---|---|
| `keyword-legacy` — as shipped before | 0.26 | 0.42 | 9/35 | 2/3 |
| **`shipped`** — scored ranking | **0.76** | **0.83** | **27/35** | **0/3** |
| `semantic` — vectors only | 0.73 | 0.72 | 22/35 | 3/3 |
| `hybrid` — rank fusion | 0.80 | 0.79 | 24/35 | 3/3 |

**Most of that gain is not the embeddings.** Scoring the same candidate set with no vectors moved
MRR from 0.26 to 0.76; the vector path adds morphology and subtracts paraphrase, which is why it
ships available and is not the default (ADR-027). Three labelled queries that genuinely need
synonymy fail in **every** configuration above.

A model-backed path was then measured and **refused for recall**: BGE-small reaches MRR 0.86 and
recall@5 0.88, taking the paraphrase class from 0.42 to 0.75, and costs 140–170ms per query
against NFR-03's 50ms budget. It is adopted for de-duplication, which has no latency budget
(ADR-028).

De-duplication was measured too and was worse than recall: at its old thresholds **F1 was 0.00**,
because they sat above the highest similarity any real duplicate reaches, and its only two
positives in the corpus were contradictions. It now runs at **F1 0.63** by default and **0.78**
with a model, merging **no** contradiction at either threshold, with the number owned by whichever
gateway produced the vectors. The values are **not** the pairwise optimum: applied as a maximum
over the pool, as the service applies them, that optimum suppresses 11 of 12 novel memories.

**The contradiction guard in front of those thresholds was re-measured and one published figure
retracted.** It had been reported as catching four of five labelled contradictions; all five
contained a negation, which was the only thing the rule could see. Against 48 reversed decisions
(`experiments/dedup/polarity.ts`, one reversal and one restatement per fixture memory) it caught
**29 of 48**. Reading the contrast construction as well as the negation takes it to **36 of 48**
and 5 of 5, with the false-block counts unchanged — EDR-007. A variant scoring 37 of 48 with a
quarter of the false blocks was **measured and declined**: its two constants were chosen by
reading the evaluation corpus, and the whole gain is on the error that costs least.

Records: `docs/evidence/recall-experiment.json`, `docs/evidence/dedup-experiment.json`. Both
baselines fail a run on a regression, and the dedup baseline now ratchets the guard's catch rate
and false-block rate alongside the similarity methods.

**Coverage and mutation are ratchet floors, not the targets.** Both thresholds had been declared
for months (80% lines, 65% MSI) and **neither had ever been evaluated** — the coverage provider
could not load, and Stryker was never installed. The first real measurements were 15.24% and 9.14%.
A threshold nobody can pass is a disabled gate; a floor at the measured value blocks regressions
from today forward. The 80/65 targets stay on record in `.claude/standards/testing.md`.

**The floors are two measurements behind, and that is a live defect.** They sit at 41 and 20 in
`vitest.config.ts` and `stryker.config.json`, which were the values measured on 2026-09-10. The
records committed three days later read **59.98%** and **36.92**, and this table said 41.17 and
20.67 until 2026-10-27 — wrong against its own citations, in the flattering direction, which is why
it survived 47 days. The ratchet has therefore not ratcheted: roughly 19 points of line coverage and
16 of mutation score could regress today without a gate noticing. Raising the two floors to the
recorded values is item 4 of `reports/gs-audit-2026-10-27.md`, and it needs a fresh coverage run
first, because 16 tests have been added since the record.

**What moved the numbers.** 78 new tests: `coordination-service` (45, from zero — 771 lines),
`sync` (15, from zero — 522 lines), `session-service` (11) and `database-concurrency` (7).
Per-unit MSI now: domain entities 100%, `session-service` 90%, `coordination-service` 50.6%,
`sqlite-memory-repository` 45.8%. The largest remaining block is `src/mcp/server.ts` — 581 of 1,684
mutants with no unit coverage, deliberately still mutated, because the one real defect found today
lived exactly there.

---

## Where the project is

**Shipped and reachable** (`docs/spec.md §4` for the per-feature status markers):

- Six memory types, three tiers, weight / reinforcement / decay (F1) — ADR-012, EDR-001
- Triggers before risky actions (F2), developer preferences (F3)
- Session continuity: start / end / recover (F7)
- Three consolidated MCP tools: `chronicle`, `session`, `axon` — ADR-011
- Optional cloud mirror to Railway Postgres — ADR-010, EDR-003
- Team coordination behind `axon` — ADR-010, EDR-004
- Local read-only dashboard

**Specified, not built:** the solution library (F4), AI bias tracker (F5), insights engine (F9),
janitor (F10), ecosystem registry (F11), and the three intelligence-layer YAML artifacts (§3.3).
Distillation runs as a service but is not reachable through the MCP surface.

**Published:** `chronicle-mcp` v0.3.2 on npm. `server.json` now exists at the repository root for
the MCP Registry (NFR-08); the registry submission itself is still outstanding.

**Installed on this machine for every AI session.** Registered at **user scope** in Claude Code, so
all 23 tracked projects share one memory store:

```
chronicle: node C:/workspace/PragmaWorks/mcp/chronicle/dist/cli.js - ✔ Connected
```

Procedure, the multi-instance contract and troubleshooting: `docs/install-mcp.md`. Verified by
`pnpm run smoke` — 12/12, including two concurrent server processes on one database.

---

## GS compliance

**Seven-property score: 12 / 14** (4 → 10 → 12 in one day). Maturity **L3**. Full scoring with the
anchor named for each property, the evidence, and the tiered treatment plan:
`docs/gs-assessment.md`.

| Property | Score | Blocking gap |
|---|---|---|
| Self-describing | 2 | — |
| Bounded | 2 | — |
| Composable | 2 | — |
| Auditable | 2 | — |
| Verifiable | **2** | — MSI measured and gating; both large units now tested |
| Defended | 1 *(provisional)* | no branch protection; no TDD phase gate; gates still carry no `provenance` |
| Executable | **1** | 22 contracts run against a live runtime; all three latency NFRs are measured, and **NFR-02 does not meet its budget** — 447ms against 300ms, RM-109 |

---

## In Progress

- **v0.5.0, prepared and unpublished.** The SDK bump and the advisory allow-list cut from ten
  entries to three are committed; the suite is green against that SDK (406/406). Publishing needs
  `npm login`.
- **This branch is ahead of `master` and no PR is open.** Everything below under Completed lives
  on `pilot/companion-2026-10`.
- **GS brownfield adoption,** at step 06 with the step-03 collision unresolved (Brownfield
  Baseline).
- **Both of ADR-027's open decisions were taken** on 2026-11-10 and are recorded in ADR-028; the
  contradiction guard they depend on was sharpened the same day (EDR-007). What remains open: an
  async recall path for a user who would accept 165ms for MRR 0.86; **12 of 48 reversals the guard
  still misses**, those that substitute an antonym with no negation and no contrast marker; and
  re-deriving the scoped-negation variant against a corpus large enough to justify fitting its two
  constants. The guard still blocks 4 of 11 pool duplicates, unchanged — the second rule stopped
  that getting worse rather than improving it.

## Completed

Since the 2026-09-10 entry below, in commit order: the RLS boundary applied and verified
(ADR-023, ADR-024, `ef8b9f3`); the onboarding manual corrected to stop handing out the superuser
string (`3b32a0f`); an employer-identity guard added to the tracked hooks (`45b68e2`); the nightly
CI trigger removed (`a52a4d7`, PR #7); the Railway mirror recovered after a 34-day outage, with
isolation 15/15, cross-machine sync 16/16 and the team layer 9/9; and the GS audit of 2026-10-27
with ADR-025 to let the repository keep it (`09d68e5`, `e020a6f`).

Since then: the prompt history given its three stages, staged to analysed to evicted (ADR-026,
EDR-005, `4f216d6`); and recall given a measured ranking plus a dependency-free vector path, with
the labelled corpus committed one commit ahead of the ranker so it cannot have been tuned to it
(ADR-027, EDR-006, `863ebe1` then the implementation).

## Next Session Entry Point

**Done 2026-11-12, previously listed here.** Both floors were measured rather than estimated.
Coverage came in at **63.79%** against a floor of 59, and `vitest.config.ts` now reads 63 — its
comment had drifted too, claiming a floor of 42 beside a value of 59, so the whole floor history is
recorded there now. Mutation came in at **40.81%** against a floor of 36, over **3,372** mutants
where the September run had 2,763 — the score rose against a *larger* corpus, which is the only
version of that comparison worth making. `stryker.config.json` now reads 40.

That run also produced the finding worth more than either number. **`src/shared/text.ts` has 100%
line coverage and an 11.11% mutation score**, with **96** mutants surviving — and it is the
tokenizer that `recall-ranker.ts` and `contradiction.ts` are both built on. Every claim measured on
this branch rests on a unit whose tests execute every line and pin almost none of its behaviour.
That is the *Test Theater* pathology in `docs/gs-assessment.md`, found by the instrument that exists
to find it, in the last place this branch would have looked. Units added here score 77–84%, so the
gap is not a methodology artefact. **New entry point: kill those 96 mutants**, ahead of
`src/mcp/server.ts` (27.64%, 356 uncovered) despite server.ts being the larger count — a unit that
lies about its coverage is worse than one that admits it has none.

From the treatment plan in `docs/gs-assessment.md`. P1 items are what make every claim above
admissible:

1. **Decide NFR-02** (RM-109). This item used to read *"benchmark NFR-02/03/04 — the last wholly
   unmeasured claims"*, and that was wrong for two months: RM-104 closed on 2026-09-13 and
   `docs/evidence/README.md` said so the whole time. Re-measured 2026-11-12, cold start is **447ms
   against a 300ms budget** — and ~265ms of it is Node plus the MCP SDK, where ADR-021 measured
   that same pair at ~165ms when it set the 300. The budget was derived from a dependency that has
   since grown, so this needs ADR-021 amended, not the number moved again. NFR-03 was the one
   predicted to miss and it meets with room (p95 30ms at 10k), which is why RM-404's FTS5 work was
   struck rather than scheduled.
2. **`pnpm audit --prod --audit-level=high`** — the one gate still never run.
3. **Submit to the MCP Registry** with the new `server.json`, or strike NFR-08 (RM-105).
4. **Branch protection on `master`** and the TDD phase gate — the two remaining Defended gaps
   (RM-203, RM-204).
5. **Raise the ratchet:** unit-test `src/mcp/server.ts` (581 mutants, 0% covered) and the rest of
   `sync.ts`, then raise both floors.
6. **Open a v11-written database with v13** — ADR-015 is verified for new databases only.

Done today, previously listed here: every gate runs and passes; `sync.ts` and
`coordination-service.ts` are tested; `server.json` exists; UC-001, UC-008 and UC-009 execute
against a live server. Still open: P2 gate provenance, P4 splitting `coordination-service.ts`.

---

## Configuration

| Client | Config file | Transport |
|---|---|---|
| Copilot CLI | `~/.copilot/mcp-config.json` | stdio |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | stdio |

- Local store: `~/.chronicle/chronicle.db` (source of truth)
- Settings: `~/.chronicle/config.json` — set `railwayUrl` to enable the cloud mirror, `teamId`
  to enable `axon`. Both absent is the normal case and changes nothing locally.
- Run: `node dist/cli.js` (stdio) · `node dist/cli.js --http --port 3100` · `--dashboard`
- Install the hooks once per clone: `pnpm run hooks:install`

---

## Session log

**2026-09-10 (later) — gates executed, MCP live in every session.** Unblocked the toolchain at the
root: `better-sqlite3@11` publishes per-ABI prebuilds, none for Node 24, and there is no C++
toolchain on this machine — moved to `@13`, which ships Node-API binaries: one ABI-stable binary per
platform, no compiler, no Node pin (ADR-015). Tests went 30/41 → 41/41 immediately. Then ran every
gate for the first time and recorded each: coverage 15.24%, MSI 9.14% — against thresholds of 80 and
65 that had never once been evaluated. Wrote 78 tests: `coordination-service` 45 (771 lines, from
zero, ranking algorithm including the cycle case), `sync` 15 (522 lines, from zero, the five EDR-003
contracts), `session-service` 11, `database-concurrency` 7. Coverage → 41.17%, MSI → 20.67%, and both
thresholds converted into ratchet floors at the measured values. Built `scripts/smoke-mcp.mjs`:
generative execution driving the built server as a real MCP client, two concurrent instances on one
database. It found a defect that 119 green unit tests had not — `session(action:'end', project)`
ignored `project` and failed on an empty id — now fixed with a regression test. Committed to
multi-instance concurrency as a tested contract (ADR-016), after finding the initial diagnosis wrong:
WAL was already set and `busy_timeout` already defaulted by the driver, so the real gap was that
nothing pinned any of it. Registered chronicle at **user scope** in Claude Code — one memory store
across all 23 projects. Added `server.json`, `docs/install-mcp.md`, a Node 20/24 CI matrix and a
generative-execution CI job.

**2026-09-10 — GS compliance pass.** Audited the repository against the seven-property rubric
(4/14), then closed what could be closed structurally. Rebuilt the sentinel tree: rewrote the
corrupted `core.md`, added the missing tool-sequencing node, added `.claude/ledger.md` with six
real corrections and four real pitfalls, gave every node category-declaring frontmatter. Wrote
ADR-010…ADR-014 — four of them back-fills for decisions that shipped without a record, including
ADR-014, which records that ADR-001's search decision was never implemented. Added the EDR layer
(EDR-001…004). Filled `PRD.md` and `TechSpec.md`, which were unfilled templates occupying
required cascade slots. Corrected `spec.md`: the scope boundary contradicted three shipped
features, the memory model was stated two ways, recall was described as semantic when it is
lexical. Corrected `use-cases.md` to the real tool surface and added UC-009 for the previously
contract-less `axon` layer. Built the harness: `gs-cascade-check.mjs` (0 errors, from 13),
ESLint with cycle and layer-boundary gates, Stryker, a dependency policy with a checker,
CI, and `.githooks/` dispatchers so the fourteen hook scripts that nothing had ever invoked now
run. Fixed the broken typecheck (`rootDir` vs `tests/`) and the unloadable coverage provider.

**2026-05-08 — GS lifecycle onboarding.** Adopted the canonical document taxonomy; created the
`docs/{specs,adrs,use-cases,roadmaps,schemas,decisions,contracts}/` structure and
`docs/manifest.yaml`. Singleton specs stayed at `docs/` root, mapped in by the manifest.

**2026-04-07 — Phase p6-deploy.** Resolved the four review blockers: exception hierarchy
(`src/shared/exceptions/`), first tests, `noUncheckedIndexedAccess`, config module.
