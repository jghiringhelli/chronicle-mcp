---
node: core
type: sentinel-node
scope: identity, scope boundary, layer map, invariants
load: always
categories: [architectural-identity, constraints]
routes_to: [root]
---

# chronicle — Core

> Always loaded. Only what is true across all domains. Hard limit: 50 lines.

## Intent
Chronicle is an MCP server that gives AI coding assistants persistent, queryable memory
across every project and session. It exists to kill the cold-start problem: a new session
begins with zero context about the developer's preferences, past decisions and solutions.

## Scope boundary — what Chronicle is NOT
- NOT a code search tool. Retrieval over source code is CodeSeeker's job.
- NOT a spec/gate enforcer. Structural enforcement is ForgeCraft's job.
- NOT a task runner or orchestrator. `axon` records coordination state; it does not execute.
- NOT a hosted service. Local-first: the source of truth is `~/.chronicle/chronicle.db`.
  Cloud Postgres is an optional mirror, never the primary (see @docs/adrs/active/ADR-010).
- NOT multi-tenant. One database per developer machine.

## Memory model — six types, three tiers
Types: `episodic` `semantic` `procedural` `architectural` `insight` `coordination`.
Tiers: `buffer` (7-day TTL) → `working` (slow decay) → `core` (permanent, decayRate 0).
`procedural`, `architectural` and `insight` start in core and never decay (@docs/adrs/active/ADR-012).

## Layer Map
```
[MCP/CLI] → [Services] → [Domain] ← [Ports] ← [Adapters/Infrastructure]
Dependencies point inward. Domain imports nothing. Services depend on ports, never adapters.
Concrete adapters are wired only in src/cli.ts and src/lib/index.ts (composition roots).
```

## Invariants
- Every public function has a JSDoc with typed params and returns.
- No circular imports (gate-enforced: `pnpm run lint`).
- Test coverage ≥80% overall; mutation score ≥65% overall, ≥70% on changed code.
- Never widen `MemoryType` or `StorageTier` without an ADR — they are persisted values.
- Never write to `~/.chronicle/chronicle.db` from the domain layer.
- Read @.claude/ledger.md before generating code: it carries corrections already made.
