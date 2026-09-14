---
id: EDR-004
type: edr
status: active
tier: T2
properties: [composable, bounded]
obligations: 6
depends_on: [ADR-010, ADR-011]
---

# EDR-004: Coordination service — decomposition, ranking, assignment

**Governs:** `src/services/coordination-service.ts`, `src/infrastructure/db/team-schema.ts`
**Derives from:** ADR-010 (team layer folded in), ADR-011 (exposed as the single `axon` tool)

## Function — what this unit does

The whole team layer, behind one class. Backs every `axon` action (ADR-011).

| Concern | Operations |
|---|---|
| Roster | `addContributor` `updateAvailability` `listContributors` |
| Decomposition | `decomposeWork` `addMilestone` `evaluateMilestones` `syncSpec` |
| Assignment | `assignNext` `completeWork` |
| Merge gating | `requestMerge` `resolveMerge` `listMergeRequests` |

**Contract**

- Every operation is **synchronous** against the local SQLite handle, like every other
  repository in the tree (EDR-002). No network, no promises.
- `assignNext` MUST return `null` — never throw — when no unblocked package exists or no
  matching contributor is free. "Nothing to do" is a normal answer.
- `assignNext` MUST produce the branch name the contributor is required to use, and
  `completeWork` MUST free the contributor and promote every downstream package whose
  dependencies are now satisfied. Assignment state and availability state are never allowed
  to disagree.
- A work package MUST carry the spec section it derives from (`spec_section`). A package with
  no spec section is unanchored work, which is the failure this layer exists to prevent.
- This service MUST NOT execute anything: it records who owns what. It does not run git, does
  not run gates, does not call an agent (`core.md` scope boundary).

## Implementation — how it does it

**Priority is a reverse-topological count of transitive dependents.** For each node, BFS over
the reversed dependency graph and count everything reachable:

```
rank[i] = |{ j : j transitively depends on i }|
```

High rank means "unblocks the most downstream work", so descending rank is the order that
keeps the most contributors unblocked. It is a *count*, not a weight — two packages that
unblock three things each are equal, regardless of how large those things are.

Complexity is **O(V·(V+E))**: one BFS per node, visited-set per BFS. Deliberate. Work packages
per project are tens, not thousands, and an O(V+E) single-pass memoised variant would need
cycle handling to be correct. The BFS tolerates a cycle (the `visited` set terminates it)
where a naive memoised recursion would not — *that* is why it is written this way.

**A dependency cycle does not raise.** It yields finite, mutually-inflated ranks and no error.
There is no acyclicity validation on `decomposeWork` input. Accepted for now because the input
comes from a spec decomposition, not arbitrary user entry — but it means a malformed
decomposition degrades quietly instead of failing loudly.

**Branch names are derived, not chosen:** `feature/<contributor-slug>/<package-slug>`, with
`merge/<package-slug>` for a `merger` role and `spec/<package-slug>` for a `specwright`. The
prefix is a function of `roleRequired`, so the branch announces the role — and the name is
persisted on the work package, so the merge gate can check that the branch it was asked to
merge is the branch that was assigned.

**Merge gating stores an externally-computed verdict.** `requestMerge` records
`forgecraft_score`, `forgecraft_tier`, `forgecraft_pass` and the report; it does **not**
compute them. The caller runs the gates and passes the result. This keeps Chronicle out of
the enforcement business (that is ForgeCraft's job per `core.md`) — but it also means a caller
can record a passing verdict it never earned. The trust boundary is the caller.

**The unit is 771 lines and holds four concerns** (roster, decomposition, assignment, merge
gating) — recorded exemption `exc-004`, and the strongest refactor candidate in the tree. The
natural seams are exactly the four table groups: extract `PriorityRanker` (pure, trivially
testable) and `MergeGate` first; roster and assignment share the availability invariant and
should move together.

## Do not change without reading this

- **Do not "optimise" the BFS into a memoised recursion** without adding cycle detection
  first. The current shape is cycle-tolerant by construction; the faster shape is not.
- **Do not let this service compute a gate verdict.** It records one. Making it run gates
  puts enforcement inside the memory server and violates the scope boundary in `core.md`.
- **Do not change the branch-name convention** without updating it in the same place the
  merge gate reads it; the string is a contract between `assignNext` and `resolveMerge`.
- **Do not add a fifth concern here.** Split first. The file is already past its bound under
  a recorded exemption, and exemptions are waivers, not permission.

## Verification

- **No tests exist for this unit.** 771 lines, a ranking algorithm, a state machine across
  three tables, and a merge gate — all unverified.
- Minimum to close it: `computePriorityRanks` is a pure function over a small graph and should
  be tested first (linear chain, diamond, disconnected, **cycle**); then the
  assignment/availability invariant (`assignNext` then `completeWork` leaves no contributor
  marked `busy` with no active assignment); then the downstream-promotion rule.
- Tracked as a P1 treatment item in `docs/gs-assessment.md`, alongside EDR-003.
