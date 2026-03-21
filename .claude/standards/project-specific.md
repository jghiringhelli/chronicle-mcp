# Project-Specific Rules
<!-- Migrated from monolithic CLAUDE.md by ForgeCraft sentinel upgrade -->
<!-- Review and clean up — some content below may have been incorrectly classified as custom -->

# CLAUDE.md

<!-- ForgeCraft | 2026-03-19 | tags: UNIVERSAL | npx forgecraft-mcp refresh . to update -->

### Ports (Interfaces owned by the domain)
- **Repository ports**: `UserRepository`, `OrderRepository` — data persistence contracts.
- **Gateway ports**: `PaymentGateway`, `EmailSender` — external service contracts.
- Ports are defined in the domain/service layer, never in the adapter layer.
- Port interfaces specify WHAT, never HOW.

### Adapters (Implementations of ports)
- **Driving adapters** (primary): HTTP controllers, CLI handlers, message consumers
  — they CALL the application through port interfaces.
- **Driven adapters** (secondary): PostgresUserRepository, StripePaymentGateway,
  SESEmailSender — they ARE CALLED BY the application through port interfaces.
- Adapters are interchangeable. Swap `PostgresUserRepository` for `InMemoryUserRepository`
  in tests without changing a single line of business logic.

### Data Transfer Objects (DTOs)
- Use DTOs at layer boundaries — never pass domain entities to/from the API layer.
- **Request DTOs**: validated at the API boundary (Zod schema → typed object).
- **Response DTOs**: shaped for the consumer, not mirroring the domain model.
- **Domain ↔ Persistence mapping**: repositories map between domain entities and DB rows/documents.
- DTOs are plain data objects — no methods, no behavior, no framework decorators.

### Layer Rules
- Never skip layers. API handlers do not call repositories directly.
- Dependencies point INWARD only. Inner layers never import from outer layers.
- Domain models have ZERO external dependencies.
- The domain layer does not know HTTP, SQL, or any framework exists.

### Command-Query Separation (CQS)
- **Commands** change state but return nothing (void).
- **Queries** return data but change nothing (no side effects).
- A function should do one or the other, never both.
- Exception: stack.pop() style operations where separation is impractical — document why.

### Guard Clauses & Early Return
- Eliminate deep nesting. Handle invalid cases first, return early.
- The happy path runs at the shallowest indentation level.
- Before:
  ```
  if (user) {
    if (user.isActive) {
      if (user.hasPermission) {
        // actual logic buried 3 levels deep
  ```
- After:
  ```
  if (!user) throw new NotFoundError(...);
  if (!user.isActive) throw new InactiveError(...);
  if (!user.hasPermission) throw new ForbiddenError(...);
  // actual logic at top level
  ```

### Composition over Inheritance
- Prefer composing objects via interfaces and delegation over class inheritance.
- Inheritance creates tight coupling and fragile hierarchies.
- Use inheritance ONLY for genuine "is-a" relationships (rare).
- When in doubt, compose: inject a collaborator, don't extend a base class.

### Law of Demeter (Principle of Least Knowledge)
- A method should only call methods on: its own object, its parameters, objects it creates,
  its direct dependencies.
- Do NOT chain through objects: `order.getCustomer().getAddress().getCity()` — BAD.
- Instead: `order.getShippingCity()` or pass the needed data directly.

### Immutability by Default
- Use `const` over `let`. Use `readonly` on properties and parameters.
- Prefer `ReadonlyArray<T>`, `Readonly<T>`, `ReadonlyMap`, `ReadonlySet`.
- When you need to "modify" data, create a new copy with the change.
- Mutable state is the #1 source of bugs. Restrict it to the smallest possible scope.

### Pure Functions
- A pure function: same inputs → same outputs, no side effects.
- Domain logic, validation, transformation, and calculation should be pure.
- Side effects (I/O, logging, database) are pushed to the edges (adapters).
- Pure functions are trivially testable — no mocks needed.

### Factory Pattern
- Use factories to encapsulate complex object construction.
- Factory methods on the class itself for simple cases: `User.create(dto)`.
- Factory classes/functions when construction involves dependencies or conditional logic.
- Factories are the natural companion to dependency injection — the DI container
  IS the top-level factory.

> **Design reference patterns** (DDD, CQRS, GoF) available on demand via `get_design_reference` tool.

### Pipeline
- Every push triggers: lint → type-check → unit tests → build → integration tests.
- Merges to main additionally run: security scan → deploy to staging → smoke tests → promote.
- Pipeline must complete in under 10 minutes. Parallelize test suites, cache dependencies.
- Failed pipelines block merge. No exceptions.

### Environments
- Minimum three environments: **development** (local), **staging** (mirrors prod), **production**.
- Environment config is injected — same artifact runs everywhere with different env vars.
- Staging is a faithful replica of production (same provider, same DB engine, same services).

### Deployment Strategy
- Default: **rolling deployment** with health checks (zero downtime).
- For critical services: **blue-green** or **canary** with automated rollback on error rate spike.
- Every deploy is tagged with git SHA. Rollback = redeploy a previous SHA.
- Deployment must be one command or one button. No multi-step manual runbooks.

### Preview Environments
- Pull requests get ephemeral preview deployments where feasible (Vercel, Netlify, Railway).
- Preview URLs in PR comments for stakeholder review before merge.

### Coverage Targets
- Overall minimum: 80% line coverage (blocks commit)
- New/changed code: 90% minimum (measured on diff)
- Critical paths: 95%+ (data pipelines, auth, PHI handling, financial calculations)

### Test Rules
- Every test name is a specification: `test_rejects_duplicate_member_ids` not `test_validation`
- No empty catch blocks. No `assert True`. No tests that can't fail.
- Test files colocated: `[module].test.[ext]` or in `tests/` mirroring src structure.
- Flaky tests are bugs — fix or quarantine, never ignore.

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

### CodeSeeker — Graph-Powered Code Intelligence
CodeSeeker builds a knowledge graph of the codebase with hybrid search
(vector + text + path, fused with RRF). Use it for:
- **Semantic search**: "find code that handles errors like this" — not just grep.
- **Graph traversal**: imports, calls, extends — follow dependency chains.
- **Coding standards**: auto-detected validation, error handling, and state patterns.
- **Contextual reads**: `get_file_context` returns a file with its related code.
Indexing is automatic on first search (~30s–5min depending on codebase size).
Most valuable on mid-to-large projects (10K+ files) with established patterns.
Install: `npx codeseeker install --vscode` or see https://github.com/jghiringhelli/codeseeker

### Learned Corrections
- [AI assistant appends corrections here with date and description]
