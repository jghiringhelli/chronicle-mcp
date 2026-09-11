---
id: ADR-017
type: adr
status: active
tier: T1
properties: [defended, auditable]
obligations: 6
depends_on: [ADR-003, ADR-014]
---

# ADR-017: Drop `fastembed` from the install tree; baseline the SDK's advisories

**Date:** 2026-09-10
**Status:** Accepted
**Supersedes:** the *acceptance* in ADR-003 (its reasoning about the trade-off stands; its premise
about install behaviour was wrong)

## Context

The supply-chain gate had never run. The first execution of
`pnpm audit --prod --audit-level=high` reported **59 advisories: 1 critical, 18 high**. They fall
into two groups with completely different properties:

| Source | HIGH+CRITICAL | Fixable here? |
|---|---|---|
| `fastembed > tar` | **9** (1 critical) | yes — by not shipping `fastembed` |
| `@modelcontextprotocol/sdk > {ajv>fast-uri, express>router>path-to-regexp, express-rate-limit>ip-address, hono}` | **10** | **no** |

**On `fastembed`.** ADR-003 accepted one `tar` HIGH on the grounds that `fastembed` is
*"optional + isolated — the core memory server never imports `tar`; only the opt-in embedding path
does."* The isolation claim is true about **execution** and false about **installation**:
`optionalDependencies` in npm/pnpm means *"do not fail the install if this cannot be built"*, not
*"do not install it"*. `fastembed` was in every install tree, and so was `tar`. Verified directly:
`node_modules/fastembed` present after a clean install.

So the accepted risk was not "an opt-in path a few users take". It was "every consumer of
`chronicle-mcp` inherits nine `tar` advisories, one of them a critical DoS, for a promote-time
de-duplication nicety they may never use". That is a materially different trade, and it was accepted
against the wrong facts.

There is also no code reason to ship it. `FastEmbedGateway` reaches the package through
`await import('fastembed')`, `available()` returns false when it is missing, and
`tsup.config.ts` already marks it `external`. Absence is a fully handled state (ADR-014 §2).

**On the SDK chain.** Bumping `@modelcontextprotocol/sdk` from 1.27.1 to 1.30.0 — the latest —
cleared none of its ten. The SDK bundles `express`, `hono` and `ajv` for its HTTP transports, and
those advisories are upstream. Chronicle cannot fix them, and it does use the HTTP transport:
`cli.ts` imports `StreamableHTTPServerTransport` for `--http` mode. Claiming the code is never
executed would be false.

## Decision

1. **`fastembed` is removed from `optionalDependencies`.** It is not in the install tree. Semantic
   de-duplication stays available to anyone who wants it, by installing the package themselves:
   `pnpm add fastembed`. Absent it, `promote` de-duplicates lexically, which is the documented
   fallback.
2. **The optional import is typed by an ambient declaration** at `src/types/fastembed.d.ts`, so the
   typecheck is deterministic whether or not the package is installed. A `@ts-expect-error` would
   not do: it errors as *unused* whenever the package IS present. The declaration MUST stay minimal
   — if the gateway needs more of fastembed's API, that is the signal to make it a real dependency
   and delete the file.
3. **The ten SDK advisories are recorded as an explicit allowlist**, in
   `package.json` → `pnpm.auditConfig.ignoreGhsas`, each annotated with its path. The gate stays at
   `--audit-level=high` and still **fails on anything not on that list**. This is the ratchet
   applied to the supply chain: a known, named, reviewable set is accepted; a new advisory breaks
   the build.
4. **Every SDK bump MUST re-check the list** and delete the ids that clear. An allowlist that only
   grows is how a baseline becomes a blindfold.
5. `docs/dependency-policy.md` records both, and its approved-runtime table no longer lists
   `fastembed`.

## Alternatives Considered

- **Keep `fastembed` and allowlist the nine `tar` ids too.** Rejected. The advisories are real, one
  is critical, and unlike the SDK's they are *avoidable* — the package does not need to ship. An
  allowlist is for risk you cannot remove, not risk you would rather not think about.
- **Keep it but pin `tar` with a pnpm override.** Considered seriously. `pnpm.overrides` could force
  `tar@>=7.5.19`, but fastembed's extraction path is not tested against that major here, and a
  forced transitive upgrade that nobody exercises trades a known advisory for an unknown breakage.
  Reasonable to revisit if semantic de-dup becomes a default feature.
- **Replace `fastembed` with Transformers.js or a pure-JS embedder.** Deferred, not rejected —
  ADR-003 already names the gateway port as the seam that makes this a single-file change. The right
  time is when semantic recall is actually built (ADR-014 §3), not during a merge.
- **Drop the `--audit-level=high` gate to `critical`.** Rejected outright. That is the disabled-gate
  move: it would have hidden all ten SDK highs and produced a green check over an unexamined tree.
- **Vendor the SDK or fork it.** Rejected. Disproportionate, and it makes every future SDK update a
  merge.

## Consequences

**Positive.** A default `chronicle-mcp` install carries no `tar` and no critical advisory. The
supply-chain gate passes on a **true** statement: zero unignored HIGH, with ten named exceptions
traceable to this record. Consumers who want semantic de-dup opt in explicitly, which is what
"optional" was supposed to mean.

**Negative.** Semantic promote-time de-duplication is now off by default, so the `team promote`
action falls back to lexical unless the user installs `fastembed`. That is a capability regression
for anyone who expected it out of the box, and `docs/TEAM-SETUP.md` must say so. The ambient
declaration is a small maintenance surface that can drift from fastembed's real API — it is
deliberately minimal to keep that cheap.

Ten HIGH advisories remain in the production tree through the SDK and are accepted rather than
fixed. They are not invisible — they are listed, annotated and re-checked on every bump — but they
are real, and the HTTP transport that reaches them is code this project ships.

## Verification

- `pnpm audit --prod --audit-level=high` → exit 0, `10 high (10 ignored)`, recorded in
  `docs/evidence/`.
- `pnpm run typecheck` → exit 0 with `fastembed` absent from `node_modules`, which is the case this
  decision creates.
- `pnpm run build` → exit 0; `tsup` externalises the import rather than trying to bundle it.
- 168 tests pass, including `tests/unit/infrastructure/fastembed-gateway.test.ts`, which exercises
  the unavailable path.
- **Not verified:** the `available() === true` path, which needs `fastembed` actually installed. It
  is now an opt-in configuration, so it needs its own CI job or a documented manual check.
