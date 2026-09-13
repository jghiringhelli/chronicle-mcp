---
id: DEP-POLICY
type: gate
status: active
tier: T1
properties: [defended]
obligations: 8
depends_on: [ADR-001]
---

# Dependency Policy

> **Why this is a separate document.** Architectural correctness and supply-chain safety are
> orthogonal. A repository can score full marks on all seven specification properties —
> perfect layers, full enforcement, complete audit trail — and still ship high-severity CVEs
> pulled in by an unconstrained dependency chain. The seven-property rubric grades how the
> agent *structured* what it produced, not what it *selected*. An executor handed no
> dependency policy is unconstrained in the supply-chain dimension, and will act like it.
>
> Enforced by `scripts/check-dependency-policy.mjs` and `pnpm audit`, both gated in CI.

---

## Normative rules

1. `pnpm audit --prod --audit-level=high` MUST report zero **unignored** HIGH or CRITICAL
   advisories. A new HIGH blocks the build; it is not triaged into a backlog.
   The only accepted exceptions are the ids listed in `package.json` →
   `pnpm.auditConfig.ignoreGhsas`, every one of which MUST be (a) transitive through a dependency
   this project cannot replace, (b) annotated with its path, and (c) recorded in an ADR. Today that
   is ten advisories reached through `@modelcontextprotocol/sdk` (ADR-017).
   **An allowlist that only grows is a blindfold:** every SDK bump MUST re-run the audit and delete
   the ids that have cleared.
2. Every runtime dependency MUST appear in the Approved Runtime table below. Adding one
   requires adding its row — name, why, what it replaces — in the same commit.
3. Nothing in the Forbidden table may be introduced, at any version.
4. A runtime dependency MUST NOT be added when the Node standard library or an existing
   dependency covers the need. Search semantically before adding
   (`.claude/standards/tool-sequencing.md` §3).
5. Versions MUST be declared as caret ranges on a supported major. A `*`, `latest`, `>=`
   with no upper bound, or a git/tarball URL is forbidden in `dependencies`.
6. `packageManager` MUST pin the pnpm major. This repo is pnpm-only; an `npm install` here
   produces a second lockfile and a divergent `node_modules`.
7. A native dependency MUST be paired with a Node range it can actually honour.
   - If it ships **per-ABI** prebuilds (one binary per Node major), `engines.node` MUST be a
     **closed interval** naming only the majors it publishes for. An open range there promises
     support that does not exist.
   - If it ships **Node-API** prebuilds (one ABI-stable binary per platform, no Node version in
     the filename), an **open lower bound is correct** and a closed interval would be a lie in the
     other direction — it would refuse Node majors the dependency handles fine. The NAPI version
     requirement is the real constraint and is named in the table below.
   - A NAPI package that also carries a `binding.gyp` MUST be kept out of pnpm's
     `onlyBuiltDependencies`, or pnpm runs `node-gyp rebuild` anyway and the shipped binary is
     never used. *(Amended 2026-09-10 — see ADR-015. The rule originally required a closed
     interval unconditionally, which was correct for `better-sqlite3@11` and wrong for `@13`.)*
8. A test-tooling dependency that is versioned against a host tool (a coverage provider, a
   test-runner plugin) MUST match that host's major. A mismatch does not fail at install —
   it fails the first time the gate runs, which is how the 80% coverage threshold here went
   unevaluated.
9. The lower bound of `engines.node` MUST be at or above the lower bound every runtime
   dependency declares in its own `engines`. Rule 7 governs the *shape* of the range; this one
   governs where it starts, and the two are independent — an open lower bound can be the right
   shape and still start too low. *(Added 2026-09-12 — see ADR-022. `better-sqlite3@13` requires
   `>=22`; this package claimed `>=20`; Node 20 segfaulted rather than failing to load. Checked by
   `scripts/check-dependency-policy.mjs` against the installed tree, so it is offline and reflects
   this lockfile rather than the registry.)*

> Rules 7 and 9 are both about native dependencies and they are not the same rule. 7 asks *what
> shape* the range may take, given how the dependency ships its binaries. 9 asks *where it starts*,
> given what the dependency says it supports. Satisfying 7 and violating 9 is what happened here,
> and the symptom was a segfault — the failure mode with the least diagnostic information of any.

---

## Approved runtime dependencies

| Package | Range | Why it is here | Considered instead |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | `^1` | The protocol. Not optional. | — |
| `better-sqlite3` | `^13` | Synchronous embedded SQLite — the ADR-001 decision. Async drivers add 15–30ms/query and break the <50ms recall contract. **Node-API** since v13: one ABI-stable binary per platform, so no compiler and no per-Node-major prebuild (ADR-015). Requires NAPI 8 → Node ≥18.17; we require ≥20 for other reasons. | `node:sqlite` (still unstable), Prisma (async + server), LanceDB |
| `postgres` | `^3.4` | The optional cloud mirror (ADR-010 §3). Executed only when `railwayUrl` is configured. | `pg` (heavier, callback-era API) |
| `zod` | `^4` | MCP tool argument schemas. Already a peer of the MCP SDK, so it costs nothing extra. | hand-rolled validation |

**Note on `postgres`.** It is carried by every install and executed by almost none
(ADR-010, Consequences). If the cloud mirror stays rare, move it to an optional
peer dependency — tracked as a treatment item, not a rule.

**`fastembed` is deliberately NOT here.** It was an `optionalDependency`, which installs by default
and brought nine `tar` advisories (one critical) into every consumer's tree for a promote-time
de-duplication nicety. Removed in ADR-017. Semantic de-duplication remains available opt-in:

```bash
pnpm add fastembed      # then `team promote` de-duplicates semantically instead of lexically
```

`FastEmbedGateway` dynamic-imports it and `available()` returns false when it is absent, so nothing
breaks either way. The optional module is typed by `src/types/fastembed.d.ts`.

## Approved development dependencies

| Package | Range | Role |
|---|---|---|
| `typescript` | `^5.4` | Compiler. `strict` + `noUncheckedIndexedAccess` are both required. |
| `vitest` | `^2` | Test runner. |
| `@vitest/coverage-v8` | `^2` | Coverage provider — **major MUST match `vitest`** (rule 8). |
| `@stryker-mutator/core`, `@stryker-mutator/vitest-runner` | `^8` | Mutation gate. The only gate that measures test *quality*. |
| `eslint`, `@eslint/js`, `typescript-eslint` | `^9` / `^8` | Lint, plus the import-cycle and layer-boundary gates. |
| `eslint-plugin-import`, `eslint-import-resolver-typescript` | `^2` / `^4` | `import/no-cycle`, which is the constitution's acyclicity invariant. |
| `tsup` | `^8` | Build. |
| `tsx` | `^4` | Dev runner. |
| `@types/node`, `@types/better-sqlite3` | — | Types. |

## Forbidden

| Package | Why |
|---|---|
| `@typescript-eslint/*` `^5`/`^6` | Old transitive `minimatch` carries known CVEs. Use `typescript-eslint@^8`. |
| `tslint`, `jasmine` | Deprecated / unmaintained for this use. |
| `request`, `node-fetch@^2` | Deprecated; `fetch` is built in on Node 20. |
| `moment` | Unmaintained, large; `Intl` + ISO strings cover every need here. |
| `lodash` (whole-package) | Pulls a large surface for utilities the standard library has. |
| any ORM (`prisma`, `typeorm`, `sequelize`) | Rejected in ADR-001. An ORM here reintroduces async and a migration runner for a single-user embedded database. |
| any telemetry / analytics SDK | `docs/spec.md` guarantees no telemetry. A dependency that phones home breaks the product's central promise. |

---

## Adding a dependency — the sequence

1. Check `package.json`. Already present at a compatible major → stop.
2. Search the codebase semantically for an existing utility that covers the need.
3. Confirm it is not in the Forbidden table.
4. Add the row to the Approved table above, with the alternative you rejected.
5. Install with `pnpm add`, then run `pnpm audit --prod --audit-level=high`.
6. Commit as `chore(deps):` — the lockfile change travels with the policy change, never
   inside a feature commit.
