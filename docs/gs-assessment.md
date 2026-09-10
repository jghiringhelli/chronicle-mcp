---
id: GS-ASSESSMENT
type: status
status: active
tier: T1
properties: [auditable, verifiable]
obligations: 0
generative_execution: red
depends_on: [SPEC, ADR-013]
---

# Generative Specification — Self-Assessment

**Repository:** `chronicle-mcp` v0.3.2
**Assessed:** 2026-09-10
**Rubric:** the seven specification properties, scored against the calibration anchors in
*GS_Rubric_ScoringGuide* §1–7, with the R1–R7 refinements applied.
**Assessor:** Claude Opus 5, on the artifact set alone, as a stateless reader.

> **Admissibility.** A score is admissible only when the assessor can name the anchor it is
> closest to. Every row below names its anchor and the evidence it rests on. **Defended** is
> marked **provisional**: whether adversarial challenge has been anticipated and answered
> cannot be machine-verified, so it needs human confirmation before the treatment plan is
> final.

---

## Score

Assessed in two passes on the same day. Pass 1 was structural — artifacts, sentinel, decision
records. Pass 2 executed the gates, which is the only thing that can move **Verifiable** and
**Executable**, and is where the interesting findings were.

| Property | Start | Pass 1 | Pass 2 | Anchor named (now) |
|---|---|---|---|---|
| **S** — Self-describing | 1 | 2 | **2** | Intent and scope-boundary statements both explicit and *true*; conventions stated; rationale layer recoverable |
| **A** — Auditable | 1 | 2 | **2** | Conventional commits **and** a maintained ADR corpus; status artifact derived from evidence, not authored |
| **V** — Verifiable | 0 | 1 | **2** | Automatic, fast, blocking **and adversarial**: mutation gates changed code, tests target interfaces, NFRs are quantified acceptance criteria |
| **E** — Executable | 0 | 0 | **1** | Some behavioural contracts pass against a live environment (12/12 over real MCP stdio); partial materialisation — the latency NFRs are still unrun |
| **D** — Defended | 0 | 1 | **1** *(provisional)* | Gates exist and run; the corpus is not yet provenance-bearing and the TDD phase sequence is unenforced |
| **B** — Bounded | 1 | 2 | **2** | All artifacts within the read budget; five categories collectively declared **and gate-enforced**; tool sequencing explicit |
| **C** — Composable | 1 | 2 | **2** | Dependency inversion at the composition root; layer boundaries enforced by lint — and the lint run proved **zero** cycle or boundary violations |
| **Total** | **4 / 14** | 10 / 14 | **12 / 14** | |

**Maturity level: L3.** The artifact set is derivable, the harness blocks, and contracts execute
against a live runtime. Not L4: the verify-and-correct loop is open — the latency NFRs have never
been measured, and the mutation floor is 20.67% against a 65% target.

**The two lowest scores are the next two moves** (Field Guide §4): **Executable** (1) — benchmark
the NFRs — and **Defended** (1) — branch protection, the TDD phase gate, and gate provenance.

### Why Verifiable reached 2 and Executable did not

Verifiable asks whether the checking infrastructure *exists and is adversarial*. It does: mutation
testing now gates, and the score is real rather than asserted. Executable asks whether the
implementation *passes its contracts against a live environment*. Twelve do; the quantified NFRs in
spec §5 do not, because nothing has measured them. The two properties are scored separately and
deliberately diverge here — collapsing them is the mistake the rubric warns about.

---

## Evidence

Every claim below is a run, not a description (R1). Records are under `docs/evidence/`.

| Gate | Before | After | Record |
|---|---|---|---|
| `gs-cascade-check` | **13 errors, 14 warnings** | **0 errors, 4 warnings** | `cascade-check-baseline.json`, `cascade-check-after.json` |
| `tsc --noEmit` | **exit 2** — TS6059 on all four test files | **exit 0** | `typecheck.txt` |
| `vitest run` | **30 / 41** (11 native-binding failures) | **119 / 119** | `test-coverage.txt` |
| coverage | **could not load the provider** — never once evaluated | **41.17% lines** (was 15.24% at first run) | `test-coverage.txt` |
| `eslint` | **no config existed** — could never have passed | **0 errors**, 32 waived warnings | `lint.txt` |
| mutation (`stryker`) | **not installed** | **MSI 20.67%** (was 9.14% at first run) | `mutation.txt` |
| `check-dependency-policy` | **ok** | **ok** | `dependency-policy.txt` |
| `tsup` build | unrun | **exit 0** | `build.txt` |
| **MCP generative execution** | did not exist | **12 / 12 checks** | `mcp-smoke.json` |
| `pnpm audit --prod` | unrun | **still unrun** | — |

**The 11 original test failures were environmental and are gone.** `better-sqlite3@11` publishes
per-ABI prebuilds with none for Node 24, and there is no C++ toolchain here. The first instinct was
to pin Node 20 — correct as a description, wrong as a fix, because it makes every consumer's Node
version the product's problem. `better-sqlite3@13` ships Node-API binaries instead: one ABI-stable
binary per platform, no compiler, no Node pin (**ADR-015**). 41/41 immediately, and CI now runs a
Node 20/24 matrix so the `engines: >=20` claim is tested rather than asserted.

**Two numbers worth stating plainly.** Coverage and MSI were declared at 80% and 65% in
`.claude/standards/testing.md` for months. The first time either was evaluated they measured
**15.24%** and **9.14%**. That gap — between a standard written down and a standard ever run — is
the single most representative finding of this assessment.

### What the prior status artifact claimed

`Status.md` read: *"Tests: 39/39 passing (`pnpm run test --run` ✅)"*, *"Typecheck: clean
(`pnpm run typecheck` ✅)"*, *"Phase: complete — ✅ READY"*.

Measured: the typecheck exited 2, the suite was 30/41, the coverage gate could not load, the
lint gate had no configuration, and the mutation gate did not exist. This is R2 exactly — a
"done" status that was human-assigned rather than computed over evidence. It is the single most
load-bearing finding in this assessment, because it is the failure that hides all the others.

---

## Per-property detail

### Self-describing: 1 → 2

**Was 1** (*"documented rather than specified; the reader can describe the system but would need
to ask a colleague to act correctly at the edges"* — closest pathology *Specification Debt*):

- `docs/spec.md §6` listed cloud sync, team memory and the dashboard as **out of scope** while
  all three shipped. A scope boundary contradicting the code is worse than none: the next
  session reads it and removes the "unspecified" feature.
- The memory-model size was stated four different ways at once — `spec.md` "five types",
  `package.json` "six", `pragmaworks.dev` "three-tier", and `src/domain/types.ts` with a
  "five-memory model" header over a six-member union.
- `.claude/standards/architecture.md` — the identity node — still carried literal
  `{{framework}}` and `{{domain}}` template holes.
- `.claude/core.md` was truncated mid-sentence ("five c") and contained a raw YAML block pasted
  under "Primary Entities".
- The `axon` surface (771 lines) had no use case and no ADR.

**Now 2:** `spec.md §0` carries an explicit intent statement and a *true* scope boundary;
`core.md` is rewritten with both; the type count is derived from one declaration; the template
holes are filled and a gate fails the build on any recurrence; every shipped-but-unrecorded
decision has an ADR (002, 003, 004, 006) and `axon` has UC-009.

### Bounded: 1 → 2

**Was 1** — the canonical level-1 anchor, almost word for word: *"files within budget and
modules have nominal boundaries, but the sentinel tree is incomplete — typically the routing or
tool sequencing category is missing."* No node declared tool sequencing anywhere. The Corrections
Log and Known Pitfalls existed as empty stubs (`### [Add project-specific pitfalls here]`).

**Now 2:** `.claude/standards/tool-sequencing.md` states the order for orienting, searching,
installing, gating and recording, plus six forbidden sequences. Every node declares its
`categories` in `sentinel-node` frontmatter, and the cascade check **fails the build** when any
of the five is undeclared, when a `routes_to` target does not resolve, or when a node exceeds
the 300-line read budget without a recorded exemption. The ledger now carries six real
corrections and four real pitfalls.

The CNT keeps `CLAUDE.md` at 3 lines rather than the Field Guide's 250–300 — a deliberate
variant recorded in ADR-000, admissible because coverage is *enforced* rather than assumed.

### Composable: 1 → 2

**Was 1:** dependency inversion was real in the code (ports, adapters, composition roots) but
*unenforced* — `pnpm run lint` had no ESLint configuration at all, so the "no circular imports
(enforced by pre-commit hook)" claim in `core.md` was false.

**Now 2:** `eslint.config.js` enforces `import/no-cycle` plus `no-restricted-imports` patterns
that make the domain sealed and forbid services importing adapters. A layer violation now fails
a gate instead of passing review. EDR-001…004 give each load-bearing unit a boundary
declaration, so its change surface is stated.

### Verifiable: 0 → 2

**Was 0** (*"no blocking verification layer"* — and worse than the anchor, because the shape of
one was present): coverage thresholds declared in `vitest.config.ts` but never evaluated
(`test` omits `--coverage`, and the provider could not load anyway); no lint config; no mutation
testing despite `.claude/standards/testing.md` mandating MSI ≥65%/≥70% since March; no CI.

**Now 2.** The layer exists, blocks, and is adversarial — which is the distinguishing requirement:

- **MSI is measured and gating.** 9.14% at first run → **20.67%** after 78 new tests, with the
  threshold set as a floor. The rubric's own exemplar is the precedent for why this matters: an
  80%-line-coverage suite scoring 58.6% MSI. Here, per-unit MSI shows the difference concretely —
  domain entities **100%**, `session-service` **90%** (tests written against the contract), while
  `sqlite-memory-repository` sits at 45.8% despite being the oldest tested unit.
- **Both large units are now tested.** `coordination-service.ts` 45 tests (MSI 0 → 50.6%),
  `sync.ts` 15 tests covering the five EDR-003 contracts. The ranking algorithm is tested on four
  graph shapes including a **cycle** — the case EDR-004 says the implementation's shape exists to
  tolerate, so the test is what stops a future "optimisation" breaking it.
- **Tests target contracts, not implementations.** The `sync` suite asserts `skipped: true` with no
  configuration; the coordination suite asserts the merge-gate authorisation rule (only a `merger`
  may resolve) and the availability invariant (no contributor left `busy` with no assignment).
- **NFRs are quantified acceptance criteria** with an explicit verification status each — which is
  what level 2 asks of them. That they mostly read *unrun* is an **Executable** gap, not a
  Verifiable one.

**The thresholds are ratchet floors, and that is deliberate.** 41% lines and 20% MSI are today's
measurements, not the targets. A threshold nobody can pass is a disabled gate — the 80% that sat in
`vitest.config.ts` for months, unevaluated, is the proof. A floor at the measured value blocks
regressions from today forward, which is what a ratchet is; the 80/65 targets stay on record.

**What keeps it from being a clean 2:** `src/mcp/server.ts` holds 581 of 1,684 mutants with zero
unit coverage — and it is where the one real defect found today lived. It is deliberately still
mutated rather than excluded, so the number stays visible.

### Auditable: 1 → 2

**Was 1** (*"either commit discipline or an ADR record exists, but not both maintained"*):
conventional commits were clean, but the ADR corpus was two files for a system with at least six
non-obvious decisions. ADR-001 sat `Proposed` for five months while fully implemented — and
described a system that was **never built** (FTS5 keyword search, in-process cosine recall; the
code uses `LIKE` and no recall path touches the embedding column). Session memory referenced an
"ADR-010" that did not exist as a file.

**Now 2:** seven ADRs, four of them honest back-fills with provenance notes; four EDRs giving
the implementation layer; ADR-014 records what recall actually is and amends ADR-001; statuses
corrected; the index is gate-checked for completeness in both directions. `Status.md` is
rewritten so every claim cites a record.

The residual risk is the one this property exists to catch: a decision recorded and then
silently diverged from. ADR-001 went five months that way. The cascade check cannot detect it —
only a human reading the ADR against the code can, which is why it is in the treatment plan.

### Defended: 0 → 1 *(provisional — needs human confirmation)*

**Was 0,** precisely: *"destructive operations are discouraged but not prevented; no commit
hooks."* Fourteen hook scripts sat in `.claude/hooks/`. **Nothing invoked them** — no
`core.hooksPath`, no `.git/hooks` entries, no husky. A hook script that nothing dispatches to is
aspirational (R3), and the rubric is explicit: *"add pre-commit hooks" written in a status file
is not a defended system; hooks logging real violations are.*

**Now 1:** `.githooks/pre-commit` and `.githooks/commit-msg` dispatch to the existing scripts,
installed by `pnpm run hooks:install` and by `prepare`. CI runs the same gates on every push and
PR. `--no-verify` is explicitly forbidden in tool-sequencing §6.

**Not 2**, for three reasons:
1. **The gate corpus is not provenance-bearing.** Level 2 requires each gate to carry its
   originating incident. `.forgecraft/project-gates.yaml` is `gates: []`; the exemptions in
   `.forgecraft/exceptions.json` carry reasons but no `expires_at`, which per
   repository-discipline §9 makes them undocumented bypasses rather than waivers.
2. **TDD phase sequence is unenforced.** `testing.md` mandates RED-before-GREEN and forbids a
   `feat:` without a preceding `test:`; `pre-commit-tdd-check.sh` exists but no gate sequences
   the phases.
3. **No branch protection** on `master`. Nothing prevents a direct push.

Human confirmation needed: whether adversarial challenge has been anticipated for a tool that
stores arbitrary developer text and optionally mirrors it to a cloud Postgres.

### Executable: 0 → 1

**Anchor (level 1):** *"the implementation passes some behavioural contracts against a live
environment but not the full suite — partial materialisation; the verify-and-correct loop runs but
is not closed."* That is exactly the state.

**What now executes.** `scripts/smoke-mcp.mjs` drives the **built** server as a real MCP client over
stdio — 12/12 checks, recorded in `docs/evidence/mcp-smoke.json`: the three-tool surface (ADR-011),
UC-001's round trip, UC-008's zero-configuration start, UC-009's `axon` surface answering without a
team, the session lifecycle, and **two concurrent server processes** on one database (ADR-016).

**This is where the method earned its keep.** The smoke run found a defect that 119 green unit tests
did not: `session(action: 'end', project)` ignored `project` entirely and called
`endSession(args.id ?? '')`, so the documented F7 flow — start with a project, end with the same
project — failed with `Session not found:` and an empty id. `recover` had the fallback; `end` never
did. Fixed, with a regression test that pins the resolution rule. No amount of unit testing would
have found it, because the defect was in the boundary the units do not cross.

**Why 1 and not 2:**

- **No latency NFR has been measured.** NFR-03 is worse than unmeasured — it is **at risk**, because
  a leading-wildcard `LIKE` cannot use an index (EDR-002). The smoke test's 1ms recall is at
  smoke-test scale and is explicitly labelled as not an NFR-03 measurement.
- **NFR-08 is half-closed.** `server.json` now exists and validates against the registry schema; the
  submission has not been made.
- **The loop is not closed.** A failing contract does not yet fail a build automatically on this
  machine — though the CI `generative-execution` job now wires it, so the next push closes that half.
- R4 directionality: the spec corpus describes reality, but much of it was reverse-derived from the
  code during this assessment. Honest starting point, not a passing grade.

This property gates the tiers: T3 (contracts run against the live system) requires it at 2.

---

## Pathologies present

| Pathology | Evidence in this repository | Status |
|---|---|---|
| **Architectural Drift (01)** | The aggregate: four documents disagreeing about the memory model and the tool surface; an ADR describing unbuilt behaviour; a scope boundary contradicting shipped features | addressed by ADR-010…006 + the spec corrections |
| **Specification Debt (05)** | `docs/PRD.md` and `docs/TechSpec.md` unfilled templates in required cascade slots | closed — both filled; gate added |
| **Session Amnesia** | Corrections Log and Known Pitfalls were empty stubs, so nothing carried a correction forward | closed — `.claude/ledger.md`, 6 corrections + 4 pitfalls |
| **Test Theater** | 80% coverage threshold declared and never evaluated; no mutation gate; the two largest units untested | **open** — gates now exist, MSI still unmeasured |
| **AI Security Blindspot** | No dependency policy, no approved-library list, no `npm audit` gate | closed — `docs/dependency-policy.md` + `check-dependency-policy.mjs` + CI audit job |
| **ADR Absence → decision debt** | ADR-001 `Proposed` for five months while implemented; three shipped decisions unrecorded | closed — back-filled with provenance |
| **Ghost code** | `axon` (771 lines) and cloud sync (522 lines) with no use case, no ADR, no tests | half-closed — UC-009 + ADR-010 + EDRs written; **tests still absent** |
| **Phase Collapse** | TDD phase sequence unenforced; tests written after implementation | **open** |

---

## Treatment plan

Ordered by obligation tier. Each item names the property it raises and its exit criterion.

### P1 — admissibility of every claim — **4 of 5 done**

1. ~~**Run the gates and commit the records.**~~ **Done**, and on Node 24 rather than a pinned 20
   (ADR-015). `docs/evidence/` holds nine records. The fix was the dependency, not the environment.
2. ~~**Test `sync.ts`.**~~ **Done** — 15 tests covering the five EDR-003 contracts, with a fake
   `sql` client and real `:memory:` SQLite. No network.
3. ~~**Test `coordination-service.ts`.**~~ **Done** — 45 tests. `computePriorityRanks` on a linear
   chain, a diamond, disconnected components and a **cycle**; plus the availability invariant,
   branch derivation for all three role prefixes, downstream promotion, and the merge-gate
   authorisation rule (only a `merger` may resolve).
4. **Benchmark NFR-02/03/04** and write the numbers to `docs/evidence/` — **still open** (RM-104),
   and now the single largest remaining gap. If NFR-03 misses, ADR-014 §3 (FTS5) moves from planned
   to scheduled. A missed benchmark is a result, not a failure.
5. ~~**Fix or retract NFR-08.**~~ **Half done** — `server.json` exists and validates against the
   registry schema; the submission has not been made (RM-105).

**Added by pass 2, not foreseen:**

6. **Run `pnpm audit --prod --audit-level=high`** — the one gate that has still never executed.
7. **Open a v11-written database file with v13.** ADR-015 is verified for *new* databases only; an
   existing `~/.chronicle/chronicle.db` has not been opened under test by the new driver.
8. **Unit-test `src/mcp/server.ts`** — 581 of 1,684 mutants, zero coverage, and the location of the
   one real defect found today. The biggest single lever on MSI.

### P2 — the gate corpus becomes provenance-bearing (Defended 1 → 2)

6. **Give every gate its originating incident.** Each entry in `.forgecraft/project-gates.yaml`
   carries the incident that caused it. The four pitfalls in the ledger are four ready-made
   entries. Exit: no gate exists without a `provenance` field.
7. **Add `expires_at` to all eight exemptions**, or remove them. An exemption without an expiry
   is a bypass. `exc-004` (the 771-line service) expires when item 3 lands.
8. **Enforce branch protection on `master`:** required status checks, no direct push, linear
   history.
9. **Wire the TDD phase gate** so a `feat:` commit with no preceding `test:` is blocked.

### P3 — close the loop from runtime back to spec (Executable 1 → 2)

10. **Execute UC-001…UC-009 against a live MCP client** on a Node matrix, and record the
    results. This is the generative-execution step: the agent operates the real machine and
    checks output against the specification. Exit: every UC status line is green or explicitly
    blocked with a reason.
11. **A clean-machine `npx -y chronicle-mcp` test** — UC-008 is about exactly this and has never
    been run where it means anything.
12. **Audit each ADR against the code it governs.** ADR-001 diverged for five months and no gate
    noticed; only a human reading decision against implementation catches that class. Quarterly,
    and on every ADR touch.

### P4 — structural debt (Bounded, Composable)

13. **Split `coordination-service.ts`** at the four seams EDR-004 names — `PriorityRanker` and
    `MergeGate` first. Exit: no unit over 500 lines without an expiring exemption.
14. **Spec-map for `spec.md`** if it passes ~500 lines (426 now): a ~50-line map pointing each
    task to the line ranges it needs, rather than loading the whole file.
15. **Write the `memory_type = 'session'` migration** that ADR-012 §2 requires.
16. **Decide Q1–Q4** in `docs/PRD.md`. Each is a real open decision; leaving them open is fine,
    leaving them unwritten was not.

---

## Merge hazard — the unmerged v0.4.0 branch

**Scope of this assessment: `master` at v0.3.2.** The branch `feat/fold-team-into-core` carries
8 unmerged commits at v0.4.0, and it is not a stale sidetrack — it holds a `team` tool with
token-gated access, a `FastEmbedGateway`, a switch from MIT to PolyForm Small Business 1.0.0, a
commercial licence template, an MCP-client smoke test, and an ESLint 9 flat config.

Four collisions to resolve at merge, not after:

1. **ADR numbers.** That branch owns `ADR-002-fold-team-into-core.md` and
   `ADR-003-accept-fastembed-tar-risk.md`. The ADRs written here were therefore renumbered to
   010–014 and 002–009 reserved. Without that, two different decisions would have shared a
   number — which the cascade check cannot catch, because each file is individually well-formed.
2. **ADR location.** That branch's ADRs sit at `docs/adrs/` (flat). `docs/adrs/active/` is the
   canonical slot here and what the cascade check scans. Move them on merge, and index them.
3. **A dependency exception with no policy row.** Its ADR-003 accepts a HIGH `tar` advisory
   reached through the optional `fastembed` dependency. `docs/dependency-policy.md` rule 1 says
   zero HIGH/CRITICAL, and the CI `supply-chain` job enforces it. So that branch's merge **will
   fail this gate** until the exception is recorded as a policy row with a rationale and an
   expiry, or the dependency is dropped. Better to discover that here than in CI.
4. **A duplicate ESLint config.** `8ca84d7` adds one there; `eslint.config.js` is added here.
   One survives; the layer-boundary and `import/no-cycle` rules written here must be in it.

There is also a real overlap worth noting rather than losing: that branch's `FastEmbedGateway`
partially answers ADR-014 — semantic de-duplication at promote time exists there. Semantic
*recall* still does not, and the reason is architectural, not missing work: the `chronicle` tool
handler and `MemoryService.recall` are synchronous, and embedding inference is async. ADR-014
stands; closing it means a sync→async refactor of that handler, which is an ADR of its own.

**Treatment:** this belongs ahead of P2 in practice, because every P1 measurement taken on
`master` will need retaking if v0.4.0 lands soon after. Decide the merge order first; it is a
judgment call about the team experiment's timing, which is the user's to make, not the harness's.

---

## What this assessment does not measure

Per the Field Guide: the rubric grades how the system was *structured*, not what was *selected*,
and it does not touch the judgment layer. Whether Chronicle is the right product, whether the
six-type model matches how developers actually think, whether the `axon` experiment should
continue — none of that is here. Those are in `docs/PRD.md` as open questions, where they
belong. GS lowers the cost of everything downstream of those decisions; it does not make them.
