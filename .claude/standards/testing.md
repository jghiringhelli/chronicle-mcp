<!-- ForgeCraft sentinel: testing | 2026-04-20 | npx forgecraft-mcp refresh . --apply to update -->

## Testing Pyramid

```
         /  E2E  \          ← 5-10% of tests. Core journeys only.
        / Integration \      ← 20-30%. Real dependencies at boundaries.
       /    Unit Tests   \   ← 60-75%. Fast, isolated, every public function.
```

### Coverage Targets
- Overall minimum: 80% line coverage (blocks commit)
- New/changed code: 90% minimum (measured on diff)
- Critical paths: 95%+ (data pipelines, auth, PHI handling, financial calculations)
- Mutation score (MSI) — overall: ≥ 65% (blocks PR merge)
- Mutation score (MSI) — new/changed code: ≥ 70% (measured on diff)
- Note: Line coverage and mutation score are both required. 80% line coverage can coexist
  with 58% MSI when tests execute code without asserting its behavior (confirmed in Shattered
  Stars). Run stryker-mutator immediately after writing each test batch, not only pre-release.
  Tooling: stryker-mutator (JS/TS), mutmut (Python), Pitest (Java).

### Test Rules
- Every test name is a specification: `test_rejects_duplicate_member_ids` not `test_validation`
- No empty catch blocks. No `assert True`. No tests that can't fail.
- Test files colocated: `[module].test.[ext]` or in `tests/` mirroring src structure.
- Flaky tests are bugs — fix or quarantine, never ignore.
- After writing tests for any module, run Stryker on that module before moving on.
  Surviving mutants = missing assertions. Fix before proceeding.

### Test Doubles Taxonomy
Use the correct double for the job:
- **Stub**: Returns canned data. No assertions on calls. Use when you need to control input.
- **Spy**: Records calls. Assert after the fact. Use to verify side effects.
- **Fake**: Working implementation with shortcuts (in-memory DB). Use for integration-speed tests.
- **Mock**: Pre-programmed expectations. Assert call patterns. Use sparingly — they couple to implementation.
Prefer stubs and fakes over mocks. Tests that mock everything test nothing.

### Test Data Builders
- Use Builder or Factory pattern for test data: `UserBuilder.anAdmin().withName('Alice').build()`.
- One builder per domain entity. Builders provide sensible defaults so tests only specify what matters.
- No raw object literals scattered across tests. Centralize in `tests/fixtures/` or `tests/builders/`.

### Property-Based Testing
- For pure functions with wide input ranges, add property tests (fast-check, Hypothesis, QuickCheck).
- Define invariants, not examples: "sorting is idempotent", "encode then decode = identity".
- Property tests complement, not replace, example-based tests.

## Test-Driven Development (TDD)

### Red-Green-Refactor — The Only Cycle
1. **RED**: Write a failing test that describes the desired behavior. Run it. It MUST fail.
   If it passes, the test is wrong — it's not testing what you think.
2. **GREEN**: Write the minimum code to make the test pass. No more.
3. **REFACTOR**: Clean up while all tests stay green. No new behavior in this step.
Repeat. Every feature, every function, every bug fix follows this cycle.

### Tests Are Specifications, Not Confirmations
- Write tests against **expected behavior**, never against current implementation.
- A test that passes on broken code is worse than no test — it provides false confidence.
- Never weaken an assertion to match what the code currently does. If the code disagrees
  with the spec, the code is wrong.
- Never write a test suite after the fact that just "locks in" existing behavior without
  verifying it's correct.

### Bug Fix Protocol
- **Every bug fix starts with a failing test** that reproduces the bug.
- The test must fail before the fix and pass after. No exceptions.
- If you can't write a reproducing test, you don't understand the bug well enough to fix it.

### One Behavior Per Test
- Each test verifies exactly one behavior or rule.
- A test with multiple unrelated assertions is testing multiple things — split it.
- Test name = the specification: `rejects_expired_tokens`, not `test_auth`.

## TDD Enforcement — Forbidden Patterns and Gate Protocol

Instructions describe a process. Gates enforce it. This block defines what is
structurally prohibited, what output is required at each gate, and how the
commit sequence makes the TDD cycle auditable.

### Forbidden Patterns (non-negotiable)
The following are architecture violations, not style preferences:
- **NEVER write an implementation file before running and showing a failing test.**
  Stating that "the test would fail" is not equivalent to running it. Run it.
- **NEVER write tests after implementation** except for bug fix reproduction tests on
  pre-existing code not yet covered. Even then: write the test, show it fails, fix,
  show it passes.
- **NEVER weaken an assertion** to make a test pass. If the assertion disagrees with
  the output, the implementation is wrong.
- **NEVER skip the refactor phase** because "the code is clean enough." The refactor
  phase exists to enforce separation of concerns under green. Skipping it is a
  commitment not to separate concerns in that increment.
- **NEVER commit a `feat:` or `fix:` with no corresponding `test:` commit** preceding
  it in the same branch. The test commit is the audit trail that the red phase occurred.

### The Session Gate Protocol
TDD across a multi-step session requires explicit checkpoints the AI reports and the
human can verify. At each gate, the AI must output the actual test runner output,
not a summary of what it expects.

```
┌─────────────────────────────────────────────────────┐
│  PHASE 1: RED                                       │
│  Action:  Write test for the specified behavior     │
│  Gate:    Run test — paste full failure output      │
│  Block:   Cannot proceed until failure is shown     │
│  Commit:  test(scope): [RED] describe behavior      │
└───────────────────┬─────────────────────────────────┘
                    │ failure confirmed
┌───────────────────▼─────────────────────────────────┐
│  PHASE 2: GREEN                                     │
│  Action:  Write minimum implementation              │
│  Gate:    Run test — paste full passing output      │
│  Block:   Cannot proceed until passing is shown     │
│  Commit:  feat(scope): implement to satisfy test    │
└───────────────────┬─────────────────────────────────┘
                    │ green confirmed
┌───────────────────▼─────────────────────────────────┐
│  PHASE 3: REFACTOR                                  │
│  Action:  Improve structure, not behavior           │
│  Gate:    Run full suite — paste summary output     │
│  Block:   Cannot commit if any test regresses       │
│  Commit:  refactor(scope): clean without behavior   │
└─────────────────────────────────────────────────────┘
```

### Commit Sequence as Audit Trail
The git log for any feature must be readable as:
```
test(cart): [RED] add test for removing last item empties cart
feat(cart): remove last item empties cart
refactor(cart): extract empty-check to CartState predicate
```
This sequence is auditable. An AI that wrote the `feat:` commit without the preceding
`test:` commit either skipped the red phase entirely or conflated it with implementation.
The commit hook `pre-commit-tdd-check.sh` detects the second pattern before it lands.

### Why Instructions Alone Are Not Sufficient
A language model generating in a single context window experiences no time delay between
writing a test and writing an implementation that passes it. The RED phase is structurally
collapsed. The gates above exist precisely to make the phases non-simultaneous:
- The test commit must happen before the implementation can be written.
- The failure output must be produced (by running the code) before the game state is known.
- The model cannot "know" the failure output without actually running the test,
  because the failure messages are not in the training distribution for this specific code.
These gates transform TDD from a discipline into a constraint.

## Data Guardrails ⚠️
- NEVER sample, truncate, or subset data unless explicitly instructed.
- NEVER make simplifying assumptions about distributions, scales, or schemas.
- State exact row counts, column sets, and filters for every data operation.
- If data is too large for in-memory, say so — don't silently downsample.

## Techniques
Named techniques, algorithms, and domain frameworks active in this project.
Each name activates the AI's full training on that technique — no explanation needed.
A technique named here is available at the full depth of the model's training on it.
### Active Techniques
<!-- Add project-specific techniques below.
     Examples: RAPTOR indexing · BM25+vector hybrid with RRF fusion ·
     PCA geometric validation · deontic modal logic · CQRS · Saga pattern -->
- [Add named techniques here]
