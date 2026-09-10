---
id: EDR-001
type: edr
status: active
tier: T1
properties: [composable, verifiable]
obligations: 5
depends_on: [ADR-012]
---

# EDR-001: Memory weight, decay and tier promotion

**Governs:** `src/domain/entities/memory.ts`, `src/domain/types.ts` (`DECAY_RATES`,
`DEFAULT_TIERS`, `REINFORCEMENT_BOOSTS`), `src/services/memory-service.ts`
**Derives from:** ADR-012 (the six types and their decay profiles)

## Function — what this unit does

Turns a piece of text into a ranked, ageing memory. Four pure operations over an immutable
`Memory`:

| Operation | In | Out |
|---|---|---|
| `createMemory(id, input)` | content + `memoryType` (+ optional project, tags, `confirmed`) | a `Memory` with weight, decay rate and tier derived from the type |
| `reinforceMemory(memory, boost)` | a memory + one of the five boosts | weight raised, `accessCount` +1, `lastAccessedAt` now |
| `decayMemory(memory, days)` | a memory + days since last access | weight lowered |
| `promoteMemory(memory, tier)` | a memory + target tier | same memory in a new tier |

**Contract**

- Weight is always in `[0, 1]`. Both mutators MUST clamp; a caller never needs to.
- Every operation returns a **new** object. `Memory` is `readonly` throughout and `tags` is
  frozen — callers MUST NOT mutate a returned memory.
- `decayRate === 0` means permanent: `decayMemory` MUST return the input unchanged, so a
  `procedural`, `architectural` or `insight` memory can never be aged out by any number of
  decay passes. This is the invariant the janitor (spec §F10) also MUST respect.
- `confirmed: true` overrides the type's profile: weight `0.5 + 0.25`, decay `0`, tier `core`.
- The domain layer MUST NOT read the clock from anywhere but `new Date()` inside these
  functions, and MUST NOT touch the database.

## Implementation — how it does it

**Reinforcement is asymptotic, not additive:**

```
weight += boost × (1 − weight)
```

Each hit closes a fixed *fraction* of the remaining distance to 1.0, so weight approaches
1.0 and never reaches it. A memory recalled fifty times does not crowd out everything else,
and a single `TRIGGER_HIT` (0.20) on a cold memory moves it more than on a hot one — which
is the intent: novelty is informative, repetition is not.

**Decay is exponential in days since last access, not since creation:**

```
weight ×= e^(−decayRate × daysSinceLastAccess)
```

Keyed on access, so an old memory that is still used stays hot. `decayRate` is the
per-day exponent; the half-lives quoted in ADR-012 are `ln 2 / decayRate`
(0.10 → ~6.9d, 0.02 → ~34.7d, 0.01 → ~69.3d). The rates are the authored numbers; the
half-lives are derived — **never** edit a half-life comment independently of its rate.

**The boost ladder is ordered by how much evidence the event carries**, not by convenience:
`CONFIRMED_REMEMBER` 0.25 > `TRIGGER_HIT` 0.20 > `RECALL_HIT` 0.15 > `DISTILL_SELECT` 0.10 >
`CONTEXT_INJECT` 0.05. A human explicitly confirming a fact outranks the system noticing it.

**Tier is a function of type at creation, then of access.** `DEFAULT_TIERS` seeds it;
promotion is a separate explicit call, never a side effect of reinforcement — so promotion
policy can change without touching the weight model.

## Do not change without reading this

- **Do not make reinforcement additive** (`weight += boost`) "to make hot memories rank
  higher". It removes the ceiling's meaning and lets one loop saturate the whole store.
- **Do not key decay on `createdAt`.** It looks equivalent and silently deletes the
  "old but actively used" class of memory, which is most of the value.
- **Do not give `insight` a non-zero decay** to "keep it fresh". Distilled patterns are the
  output of the intelligence layer; decaying them means re-deriving them forever.
- **Do not drop the `decayRate === 0` early return** as a redundant guard. `e^(−0 × days)`
  is `1`, so it is arithmetically redundant — and it is the single line that makes
  "permanent memories are never pruned" true by construction rather than by floating-point
  luck.
- `embedding` is deliberately `undefined` at creation and attached later by infrastructure
  (ADR-014). The domain MUST NOT await an embedding.

## Verification

- `tests/unit/domain/memory.test.ts` pins the weight clamp, the asymptote, the zero-decay
  early return and the `confirmed` override.
- `tests/unit/services/memory-service.test.ts` pins the service-level orchestration.
- Missing: a property-based test asserting `0 ≤ weight ≤ 1` over random boost/decay
  sequences. Tracked in `docs/gs-assessment.md` — the mutation gate is the mechanism that
  will surface it.
