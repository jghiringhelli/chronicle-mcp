---
id: ADR-014
type: adr
status: active
tier: T1
properties: [executable, auditable]
obligations: 4
depends_on: [ADR-001]
---

# ADR-014: Recall is keyword-first; semantic similarity is an optional gateway

**Date:** 2026-09-10
**Status:** Accepted
**Amends:** ADR-001 (the search half of its decision; the storage half stands)

## Context

ADR-001 decided: *"better-sqlite3 with FTS5 extension for keyword search and a float[]
column for vector embeddings, queried in-process with cosine similarity."*

The implementation does neither:

- `src/adapters/repositories/sqlite-memory-repository.ts` ranks with
  `content LIKE ? OR tags LIKE ?` — **not** FTS5. No virtual table is created in
  `src/infrastructure/db/schema.ts`.
- The `embedding` column exists and is written (`attachEmbedding`), and
  `EmbeddingGateway.cosineSimilarity` is defined in `src/ports/gateways/`, but **no recall
  path calls it**. Semantic similarity is used only for de-duplication when promoting a
  memory, and only when the optional `fastembed` gateway is installed.
- ADR-001 also names `~/.chronicle/memory.db`; the code uses
  `~/.chronicle/chronicle.db` (`src/shared/config/index.ts`).

So for five months the recorded decision described a system that was never built. Nothing
caught it, because no gate compared the ADR to the code — which is precisely what
*Architectural Drift* looks like from the inside, and why `docs/gs-assessment.md` scores
Auditable below its apparent level.

Two honest resolutions existed: build what ADR-001 says, or record what was actually
decided. The second is correct here — the shipped behaviour meets the published NFRs
(`recall()` <50ms at 10k memories) and a mandatory embedding model would break the
"no configuration required beyond the npx command" contract in UC-008.

## Decision

1. **Keyword matching is the primary recall path** and MUST remain dependency-free: no model
   download, no API key, no native extension beyond `better-sqlite3` itself.
2. **Embeddings are an optional gateway.** When no `EmbeddingGateway` is wired, every recall
   path MUST behave identically minus semantic ranking — absence is never an error.
3. **FTS5 replaces `LIKE` as the keyword implementation** — planned, and **no longer urgent**.
   *(Corrected 2026-09-12 by ADR-021: this section predicted the <50ms contract was at risk. Measured,
   recall is p95 13ms at 10k and 24ms at 50k. The scan is real and is not the dominant cost at this
   scale, so FTS5 is a quality-of-recall improvement rather than a latency fix.)* `LIKE '%term%'` cannot use an index, so the current path
   is O(n) with a full table scan; the published NFR is therefore **unverified**, not met.
   Until a benchmark exists under `docs/evidence/`, `docs/spec.md` MUST mark it `unrun`.
4. **No prose may claim vector recall.** `README.md`, `docs/spec.md` and `package.json`
   describe semantic similarity as an optional promote-time de-duplication feature, which is
   what it is.

## Alternatives Considered

- **Implement ADR-001 as written (FTS5 + in-process cosine over all rows).** Deferred, not
  rejected: FTS5 is planned under §3 above. Mandatory cosine-over-all-rows is rejected — it
  requires shipping or downloading an embedding model, which breaks UC-008's zero-config
  cold start and the <200ms start budget.
- **Mark ADR-001 superseded in full.** Rejected: its storage decision (better-sqlite3,
  synchronous, single file, local-first) is correct and in force. Only the search half is
  amended, so ADR-001 stays active with a pointer here.
- **Leave ADR-001 as the record and treat the gap as an implementation backlog.** Rejected:
  that is the state this ADR exists to end. A decision record that describes unbuilt
  behaviour is worse than none — the next session reads it as ground truth and builds on it.

## Consequences

**Positive.** The record now matches the code, so a stateless reader derives the real
behaviour. The zero-config contract is protected as an explicit invariant rather than an
accident.

**Negative.** Recall quality is lexical: a query phrased differently from the stored memory
misses, which is the failure the embedding column was added to prevent. This is a known
limitation, not a defect, until §3 lands. The `embedding` column and the `EmbeddingGateway`
port are carried without a recall consumer — justified by the promote-time de-dup use and by
§3, but they are the kind of unused surface that becomes ghost code if §3 slips.

## Verification

- `tests/unit/adapters/sqlite-memory-repository.test.ts` asserts the keyword path.
- A recall path MUST have a test proving it degrades cleanly with no `EmbeddingGateway` wired.
  No such test exists today — tracked as a treatment item.
- The <50ms / 10k-memory claim needs a benchmark writing to `docs/evidence/`; until then
  `generative_execution: unrun`.
