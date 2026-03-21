<!-- ForgeCraft sentinel: protocols | 2026-03-21 | npx forgecraft-mcp refresh . --apply to update -->

## Dependency Registry — AI-Maintained Security Contract

The project's approved dependency set is a **living GS artifact maintained by the AI
assistant**. It is not a template rule — template authors cannot predict which library
will gain a CVE next quarter. The AI can run an audit at the moment a dependency is
about to be added. This block prescribes that it must.

### The registry artifact

File: **`docs/approved-packages.md`** — emit in P1 alongside schema, tsconfig, package.json.
Update it every time a dependency is added or upgraded. If it exists only in prose or a
README reference, it does not exist.

```markdown
# Approved Packages

| Package | Version range | Purpose | Alternatives rejected | Rationale | Audit status |
|---|---|---|---|---|---|
| example-pkg | ^2.4 | HTTP client | axios (larger bundle), node-fetch (no TS types) | Wide adoption, zero known CVEs | 0 HIGH/CRITICAL |
```

The AI populates every row. The registry is the authoritative record of WHY each
dependency was chosen and that it was clean at the time of addition.

### Process rules — stack-agnostic

1. **Before adding any package**: run the project's audit command (see table below)
   with `--dry-run` or equivalent to check the candidate for known CVEs.
   - If HIGH or CRITICAL found: choose an alternative and document the rejection.
   - If no CVE-free alternative exists: document the accepted risk and create an ADR
     naming the approver. Zero-tolerance is the default; exceptions require a record.
2. **After adding a package**: add a row to `docs/approved-packages.md` with audit status.
3. **Commit gate**: the pre-commit hook runs the audit command. HIGH or CRITICAL blocks
   the commit. If audit is not in the pre-commit hook, the gate does not exist.
4. **Version pins**: approved version ranges are locked in the lockfile (package-lock.json,
   uv.lock, Cargo.lock). The lockfile is committed. Ranges without a lockfile are not pins.

### Audit commands by ecosystem

| Ecosystem | Audit command | Threshold |
|---|---|---|
| npm / Node.js | `npm audit --audit-level=high` | HIGH or CRITICAL |
| pnpm | `pnpm audit --audit-level=high` | HIGH or CRITICAL |
| yarn | `yarn npm audit --severity high` | HIGH or CRITICAL |
| Python / pip | `pip-audit --fail-on-severity high` | HIGH or CRITICAL |
| Python / uv | `uv audit` | HIGH or CRITICAL |
| Rust | `cargo audit` | HIGH or CRITICAL |
| Go | `govulncheck ./...` | Any directly imported |
| Java / Maven | `mvn dependency-check:check -DfailBuildOnCVSS=7` | CVSS ≥ 7 |
| Ruby | `bundle audit` | HIGH or CRITICAL |

The correct command for **this project's ecosystem** must appear in the pre-commit hook
emitted in P1. Discovering CVEs at code review is too late.

## Adversarial Testing Posture

Tests are not documentation of what the code does. Tests are adversarial assertions
that the code does the right thing even when given inputs designed to break it.

### The adversarial posture
- Design every test as if the implementation is wrong until proven otherwise.
- Write tests that FAIL on incorrect code — not tests that pass on any reasonable implementation.
- If a test is hard to make fail, the specification is underspecified, not the test.

### Name tests as behaviors, not paths
- `rejects_expired_tokens` not `test_validate_token`
- `throws_on_missing_required_field` not `test_error_handling`
- `returns_empty_list_not_null_when_no_results` not `test_query`

### Cover the adversarial surface
For every public function or API endpoint, write tests for:
1. **Valid boundary values**: minimum, maximum, exact-zero, single-element
2. **Invalid boundary values**: below-minimum, above-maximum, empty, null/undefined
3. **Constraint violations**: values that look valid but break invariants (negative balance, future birth date)
4. **Ordering and concurrency**: does order matter? what if called twice?
5. **Authorization boundaries**: can a user access another user's resource?

A test suite that only exercises the happy path is documentation, not specification.
Every mutation that survives is a missing adversarial test.

## Clarification Protocol
Before writing code for any new feature or significant change:
- If the request implies architectural trade-offs that are not explicit, **ask one targeted
  question** before proceeding. Do not silently choose an architecture.
- If the domain model is ambiguous (cardinality, ownership, event ordering, shared state),
  state your assumption and ask for confirmation before implementing.
- If the request has two or more meaningfully different interpretations, present the options
  briefly and ask — do not guess and hide the choice.
- Do NOT ask about mechanical details (naming conventions, file placement, test structure) —
  apply the conventions already in this document without asking.
- Maximum one clarification round. If told "use your judgment," proceed with the most
  conservative interpretation and record the assumption in a code comment or new ADR.

## Code Generation — Verify Before Returning

When emitting implementation code across one or more files, the response is not complete
until the following are true. Show the evidence in your response — do not claim without running.

### Verification steps (in order)
1. **Compile check**: Run `tsc --noEmit` (TypeScript), `mypy` (Python), or equivalent.
   Zero errors required. Do not return with type errors outstanding.
2. **Test suite**: Run the full test suite (`jest --runInBand`, `pytest`, etc.).
   Zero failures required. Fix every failure before returning.
3. **Interface consistency**: When fixing a compile error in file A, check ALL callers of
   the changed interface. Fixing one side without seeing the other causes oscillation:
   the model fixes `service.ts` (3-param signature) but `routes.ts` still calls it with
   an object — same error reappears inverted next pass.

### Required evidence in the final response
```
tsc --noEmit: 0 errors
Jest: 109 passed, 0 failed, 11 suites
```

### Common test setup pitfalls (TypeScript / Prisma)
- **`prisma db push`, not `prisma migrate deploy`** in test environments.
  `migrate deploy` silently no-ops when no `prisma/migrations/` folder exists,
  leaving all tables absent. `db push --accept-data-loss` syncs `schema.prisma` directly.
- **`deleteMany` in FK order, not `DROP SCHEMA`**.
  `$executeRawUnsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')` throws
  error 42601 — pg rejects multi-statement queries in prepared statements.
  Use ordered `deleteMany()` calls in `beforeEach` instead.
- **JWT_SECRET minimum length**: HS256 requires ≥ 32 characters.
  Test secrets like `"test-secret"` (11 chars) cause startup errors.
  Use `"test-secret-that-is-at-least-32-chars"` in test env.

## Known Pitfalls
Recurring type errors and runtime traps specific to this project's stack.
Resolve exactly as documented — no `any` casts, ignore directives, or unlisted workarounds.
### [Add project-specific pitfalls here]
<!-- Entry format:
### Library — trap description
What goes wrong and why, then:
```
// ❌ wrong
```
```
// ✅ correct
```
-->

## Corrections Log
When I correct your output, record the correction pattern here so you don't repeat it.
### Learned Corrections
- [AI assistant appends corrections here with date and description]
