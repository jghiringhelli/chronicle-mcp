<!-- ForgeCraft sentinel: api | 2026-03-21 | npx forgecraft-mcp refresh . --apply to update -->

## API Stack Constraints — Approved Dependency Choices

These are the **approved libraries for this API project**.
Every choice has a banned alternative with a concrete reason.
If you reach for a banned alternative, stop and use the approved one instead.
Rationale is stated so you understand the constraint — not so you can argue around it.


### TypeScript API — Required Packages

| Concern | Use | Do NOT use | Reason |
|---|---|---|---|
| **Password hashing** | `argon2@^0.31` | `bcrypt`, `bcryptjs` | `bcrypt` requires a native module (`@mapbox/node-pre-gyp`) that pulls in an old `tar` CVE chain. `argon2` is pure JS, faster, OWASP-preferred. |
| **HTTP framework** | `express@^4` or `fastify@^4` | `restify`, `hapi@<21`, `koa` alone | `restify` is unmaintained. `hapi` is fine at `^21+` only. |
| **Input validation** | `zod@^3` | `joi` alone, `express-validator` alone | `zod` infers TypeScript types natively — no separate type declaration needed. |
| **JWT** | `jsonwebtoken@^9` | `jwt-simple` (abandoned), `jsonwebtoken@<9` | Security fixes landed in v9. `jwt-simple` has no active maintainer. |
| **ORM / query builder** | `@prisma/client@^5` or `kysely@^0.27` | `typeorm`, `sequelize` | `typeorm` uses decorators (not type-safe), slow migrations. `sequelize` has weak TypeScript support. |
| **Logger** | `pino@^9` | `winston` alone, `console.log` in prod | `pino` is 5–10× faster than `winston` and outputs structured JSON natively. `console.log` is not structured. |
| **HTTP client (outbound)** | `undici@^6` or native `fetch` (Node 18+) | `axios` for Node ≥18 | Native `fetch` is available; `axios` adds bundle weight and a dependency surface for a built-in feature. |
| **ESLint** | `@typescript-eslint/eslint-plugin@^8` | `@typescript-eslint@^5` or `^6` | `^6` has a known CVE via old `minimatch` transitive dep. `^8` is the current stable. |

**npm audit policy**: `npm audit` must return zero `high` or `critical` findings before the
first commit. If a dependency introduces a high/critical CVE, replace it with an alternative
from this table or open an ADR documenting the exception with mitigation.
