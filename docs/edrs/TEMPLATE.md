---
id: EDR-NNN
type: edr
status: draft
tier: T1
properties: [composable, bounded]
obligations: 0
depends_on: [ADR-NNN]
---

# EDR-NNN: [unit name]

**Governs:** `path/to/file.ts`, `path/to/other.ts`
**Derives from:** ADR-NNN

## Function — what this unit does

[Stated from the outside, functionally. What goes in, what comes out, what is guaranteed.
A caller should be able to use the unit correctly from this section alone, without reading
the implementation section.]

**Contract**
- [input constraint the caller MUST satisfy]
- [postcondition the unit guarantees]
- [failure mode, and what it throws]

## Implementation — how it does it

[The load-bearing choices inside. Name what is deliberate so the next reader does not
"improve" it. Include the formula, the complexity, the lock, the encoding — whatever a
reader would otherwise have to infer from the code and would infer wrongly.]

## Do not change without reading this

- [the trap: the change that looks like a cleanup and is a regression]

## Verification

- [test file and the behaviour it pins]
