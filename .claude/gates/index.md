---
node: gates
type: sentinel-node
scope: active quality gates, the order they run in, and how to read a failure
load: on-demand
categories: [routing]
routes_to: [root]
---

# Active Quality Gates

Gates that **run**. A gate described in a standards file and absent from the repository enforces
nothing — that is the distinction between the *shape* of rigour and the guarantee, and this repo
spent five months on the wrong side of it: fourteen hook scripts sat in `.claude/hooks/` with
nothing dispatching to them.

Order and failure meanings: @.claude/standards/tool-sequencing.md §4.

| Gate | Command | Blocks on | Threshold |
|---|---|---|---|
| Cascade / sentinel integrity | `pnpm run cascade` | pre-commit, CI | 0 errors |
| Typecheck | `pnpm run typecheck` | pre-commit, CI | 0 errors |
| Lint — import cycles, layer boundaries | `pnpm run lint` | pre-commit, CI | 0 errors |
| Tests + coverage | `pnpm run test:coverage` | pre-commit, CI | ≥80% lines |
| Mutation | `pnpm run test:mutation` | CI | MSI ≥65% overall, ≥70% changed |
| Dependency policy | `pnpm run deps:policy` | CI | 0 violations |
| Supply chain | `pnpm audit --prod --audit-level=high` | CI | 0 HIGH/CRITICAL |
| Secrets scan | `.claude/hooks/pre-commit-secrets.sh` | pre-commit | 0 matches |
| Conventional commit | `.claude/hooks/commit-msg.sh` | commit-msg | format match |

Wired by: `.githooks/pre-commit`, `.githooks/commit-msg` (install once with
`pnpm run hooks:install`) and `.github/workflows/ci.yml`. Run them all locally with
`pnpm run gates`.

## How to read a failure

- **Cascade error** — an artifact is missing, orphaned, stubbed, or outside the read budget. It
  names which. Never "fix the checker".
- **Lint: `import/no-cycle`** — the dependency graph gained a cycle. Invert a dependency through
  a port; do not add an exception.
- **Lint: `no-restricted-imports`** — a layer boundary was crossed (domain reaching outward, or a
  service importing an adapter). Inject at the composition root instead.
- **Mutation survivor** — an assertion that was not written. Never raise the threshold.
- **Coverage below 80%** — write the test. `--passWithNoTests` is for an empty suite, not a thin one.

## Gate provenance — open gap

Level 2 on **Defended** requires each gate to carry the incident that caused it. This table does
not yet; `.forgecraft/project-gates.yaml` is `gates: []`. The four entries in
@.claude/ledger.md Known Pitfalls are four ready-made provenance records. Tracked as RM-201.

Recorded exemptions live in `.forgecraft/exceptions.json`. All eight currently lack `expires_at`,
which makes them undocumented bypasses rather than waivers (RM-202).
