# Engineering Decision Records — chronicle

An **EDR** is the implementation layer of the decision record. Where an ADR states the
design envelope — *why is the system shaped this way* — an EDR states, for one unit, two
things that must travel together:

- **Function** — what this unit does, stated functionally, from the outside.
- **Implementation** — how it does it, and which choices inside it are load-bearing.

Bound side by side and kept small, an EDR hands a stateless reader the full local context
for a change without dragging in the whole system. That is the Bounded property applied to
decisions themselves.

## When to write one

Write an EDR when a unit carries an implementation choice that a reader would otherwise
"improve" into a bug — a deliberate O(n) scan, a hand-rolled serialisation, a lock, a
formula with a derivation. Do **not** write one for a unit whose implementation is obvious
from its signature.

An EDR is not an ADR: choosing SQLite is an ADR, the exact tier-promotion formula is an EDR.
An EDR is not a post-mortem: a bug worth remembering goes to `docs/decisions/`.

## Index

| ID | Unit | Governs | Status |
|---|---|---|---|
| EDR-001 | Memory weight, decay and tier promotion | `src/domain/entities/memory.ts`, `src/domain/types.ts`, `src/services/memory-service.ts` | active |
| EDR-002 | SQLite memory repository — keyword recall and row mapping | `src/adapters/repositories/sqlite-memory-repository.ts`, `src/infrastructure/db/schema.ts` | active |
| EDR-003 | Cloud sync — boundary-triggered, last-write-wins mirror | `src/services/sync.ts`, `src/infrastructure/db/cloud-schema.sql` | active |
| EDR-004 | Coordination service — decomposition, ranking, assignment | `src/services/coordination-service.ts`, `src/infrastructure/db/team-schema.ts` | active |

## Rules

- One EDR per unit. Filename `EDR-NNN-slug.md`. Start from `TEMPLATE.md`.
- The **Governs** list is the doc-to-code index: it names the files the EDR is authoritative
  for. A change to one of those files that contradicts its EDR updates the EDR in the same
  commit.
- An EDR stays under ~120 lines. Past that, the unit is doing two things — split the unit.
- An EDR that contradicts an ADR loses. Name the ADR it derives from in `depends_on`.
