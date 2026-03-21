<!-- ForgeCraft sentinel: architecture | 2026-03-21 | npx forgecraft-mcp refresh . --apply to update -->

## Project Identity
- **Repo**: {{repo_url}}
- **Primary Language**: typescript
- **Framework**: {{framework}}
- **Domain**: {{domain}}
- **Sensitive Data**: NO
- **Project Tags**: `[UNIVERSAL]`
- **Release Phase**: development

## Code Standards
- Maximum function/method length: 50 lines. If a function reads like it does two things, decompose it.
- Split a file when you find yourself using "and" to describe what it does — not when it hits a line count.
- Maximum function parameters: 5. If more, use a parameter object.
- No circular imports — module dependency graph must be acyclic (hook-enforced).
- `tsconfig.json` must include `"strict": true` AND `"noUncheckedIndexedAccess": true`.
  `strict: true` alone does not narrow `process.env.*` from `string | undefined` — the second flag is required
  to catch unguarded environment variable access at compile time.
- Every public function/method must have a JSDoc comment with typed params and returns.
- Delete orphaned code. Do not comment it out. Git has history.
- Before creating a new utility, search the entire codebase for existing ones.
- Reuse existing patterns — check shared modules before writing new.
- No abbreviations in names except universally understood ones (id, url, http, db, api).
- All names must be intention-revealing. If you need a comment to explain what a variable
  holds, the name is wrong.

## Language Stack Constraints — Seed Defaults

These are **starting defaults for typescript projects** — use them to populate the
initial rows of `docs/approved-packages.md` in P1. They are not a permanent approved
list: the AI maintains the registry from here forward, keeps versions current, and
replaces any entry that develops a known CVE. The Dependency Registry block above
governs the process.

Before adding any dependency not listed here, apply the audit-before-add process.


### TypeScript / Node.js — Approved Toolchain

**Runtime & compiler**
- Node.js: `^20 LTS` minimum. NOT `^16` or `^18` (EOL or near-EOL).
- TypeScript: `^5.4` minimum. `tsconfig.json` must include `"strict": true` AND
  `"noUncheckedIndexedAccess": true`. The second flag is required to narrow
  `process.env.*` from `string | undefined` at compile time.

**Linting**
- `eslint@^9` + `@typescript-eslint/eslint-plugin@^8` + `@typescript-eslint/parser@^8`
- NOT `@typescript-eslint@^5` or `^6` — old `minimatch` transitive dep has known CVEs.
- NOT `tslint` — deprecated.

**Test runner**
- `vitest@^2` (preferred — native ESM, fast, Jest-compatible API) or `jest@^29`.
- NOT `mocha` + `chai` for new projects (weaker TypeScript support).
- NOT `jasmine` (no active maintenance for Node.js use).

**Formatting**
- `prettier@^3` — configured via `.prettierrc`, integrated with ESLint via
  `eslint-config-prettier`. NOT separate manual formatting.

## Production Code Standards — NON-NEGOTIABLE

These apply to ALL code including prototypes. "It's just a prototype" is never a valid
exception. Prototypes become production code within days at CC development speed.

### SOLID Principles
- **Single Responsibility**: One module = one reason to change. Use "and" to describe it? Split it.
- **Open/Closed**: Extend via interfaces and composition. Never modify working code for new behavior.
- **Liskov Substitution**: Any interface implementation must be fully swappable. No isinstance checks.
- **Interface Segregation**: Small focused interfaces. No god-interfaces.
- **Dependency Inversion**: Depend on abstractions. Concrete classes are injected, never instantiated
  inside business logic. **In practice**: define `IUserRepository`, `IOrderRepository`,
  `IEmailSender` etc. as interfaces in the domain/service layer first. Services depend on
  the interface. The Prisma/SQL/HTTP concrete implementation lives in the adapter layer and
  is injected at the composition root. Emit these interfaces in P1 alongside the schema —
  a service that imports a concrete class cannot be unit-tested, cannot be swapped, and
  is not Composable.

### Zero Hardcoded Values
- ALL configuration through environment variables or config files. No exceptions.
- ALL external URLs, ports, credentials, thresholds, feature flags must be configurable.
- ALL magic numbers must be named constants with documentation.
- Config is validated at startup — fail fast if required values are missing.

### Zero Mocks in Application Code
- No mock objects, fake data, or stub responses in source code. Ever.
- Mocks belong ONLY in test files.
- For local dev: create proper interface implementations selected via config.
- No `if DEBUG: return fake_data` patterns. Use dependency injection to swap implementations.
- No TODO/FIXME stubs returning hardcoded values. Use NotImplementedError with a description.

### Interfaces First
Before writing any implementation:
1. Define the interface/protocol/abstract class
2. Define the data contracts (input/output DTOs)
3. Write the consuming code against the interface
4. Write tests against the interface
5. THEN implement the concrete class

### Dependency Injection
- Every service receives dependencies through its constructor.
- A composition root (main.py / app.ts / container) wires everything.
- No service locator pattern. No global singletons. No module-level instances.

### Error Handling
- Custom exception hierarchy per module. No bare Exception raises.
- Errors carry context: IDs, timestamps, operation names.
- Fail fast, fail loud. No silent swallowing of exceptions.
- Domain code never returns HTTP status codes — that's the API layer's job.

### Modular from Day One
- Feature-based modules over layer-based. Each feature owns its models, service, repository, routes.
- Module dependency graph must be acyclic.
- Every module has a clear public API via index.ts exports.
