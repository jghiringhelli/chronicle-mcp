---
id: ADR-025
type: adr
status: active
tier: T1
properties: [auditable, verifiable]
obligations: 4
depends_on: [ADR-013]
---

# ADR-025: A commissioned GS report is evidence, not gate output — `reports/gs-*.md` is tracked

**Date:** 2026-10-27
**Status:** Accepted

## Context

`.gitignore:10-12` carries a rule with its reasoning attached:

```
# Gate output. The REPORT is generated; the EVIDENCE is committed.
# docs/evidence/ is deliberately NOT ignored: a status claim with no committed execution
# record is not admissible (docs/evidence/README.md).
reports/
```

That rule is right about what it was written for. `reports/` was the landing place for tool
output — a coverage HTML tree, a Stryker report, a lint dump — artefacts that any machine can
regenerate from the committed source and the committed `docs/evidence/` record. Committing them
would be committing a derivative.

The gs-companion harness then asked for something at the same path that is not that. Step `02-gs-audit`
of the brownfield sequence commissions an audit with a fixed, hashed prompt and requires the answer
at `reports/gs-audit-<date>.md`; later steps read that file and will not advance without it. The
document is not regenerable: it is a judgement made once, by a named reader, against one commit, with
grades and citations that no rerun reproduces. Running the same prompt tomorrow produces a different
document, which is the point of dating it.

So the path `reports/` now holds two kinds of thing that this repository treats in opposite ways, and
the existing rule silently classifies the new kind as the old one. The first symptom was
`git add reports/gs-audit-2026-10-27.md` refusing with *"The following paths are ignored"* — a
commissioned, cited audit being discarded as tool exhaust.

Three ways out were available and two are worse. Forcing the add with `-f` leaves the next person
with a tracked file inside an ignored directory and no record of why. Relocating the audit under
`docs/` keeps the convention intact and breaks the harness, which looks for one path; the repository
would then be carrying a document the tool that commissioned it cannot find, which is the failure
`ADR-013` exists to prevent in the spec and has the same shape here.

## Decision

**A document commissioned by a canonical GS prompt is evidence and is tracked. Gate output stays
ignored.** `.gitignore` keeps `reports/` and adds one negation:

```
reports/
!reports/gs-*.md
```

The distinction is not the directory, it is whether the artefact can be regenerated from what is
committed. Coverage output can. A dated audit carrying a human-or-model judgement cannot, and a
status claim that cites a document nobody can read is exactly the inadmissible claim
`docs/evidence/README.md` already rules out.

**The rule had to be written as `reports/*`, not `reports/`.** The first attempt kept the directory
form and added the negation under it, and it did nothing: git cannot re-include a file whose parent
directory is itself excluded, so `!reports/gs-*.md` beneath `reports/` is silently inert.
`git check-ignore` still answered `.gitignore:12:reports/`. The negation only binds against the
contents form. This is recorded in the decision rather than left in the file's history because the
inert version looks correct in a diff.

Scope: `reports/gs-*.md` only. Everything else under `reports/` remains ignored, and this ADR is not
licence to track tool output by moving it under that prefix.

## Alternatives Considered

**Relocate the audit to `docs/gs-audit-<date>.md`.** Rejected. It preserves a convention at the cost
of the property the convention serves. The harness resolves this artefact by path; a document it
cannot find does not close the step, so the repository would hold an audit that no instrument can
act on. There is a better version of this objection — the path *should* be resolvable rather than
fixed, which is the artifact-map work (F-020) on the gs-companion side — but that is a change to the
tool, not a reason to misfile the document here.

**Keep `reports/` ignored and commit only a digest of the audit into `docs/evidence/`.** Rejected.
The citations are the audit. A digest of "B-, see the uncommitted file" is the unverifiable status
claim this repository forbids.

**Drop the `reports/` rule entirely.** Rejected. It is load-bearing: `coverage/` and `.stryker-tmp/`
are already ignored beside it, and un-ignoring the directory invites the 20 MB Stryker HTML tree into
the history.

## Consequences

- `reports/gs-audit-2026-10-27.md` is tracked, and every later GS report lands beside it. The audit
  trail of how this repository was assessed over time becomes part of the repository.
- A reader who adds a generated report under `reports/` with a `gs-` prefix will have it tracked
  without meaning to. The prefix is doing load-bearing work, so the negation is narrow and this
  consequence is stated here rather than discovered later.
- The GS step sequence can advance past `02-gs-audit`, which it could not before.
- `docs/evidence/` keeps its meaning unchanged: execution records, one per gate run. An audit is not
  a gate run and does not go there.

## Verification

- **Verified 2026-10-27, after one wrong attempt.** `git check-ignore -v reports/gs-audit-2026-10-27.md`
  returned `.gitignore:12:reports/` before the change, the same `.gitignore:12:reports/` after the
  directory-form attempt — the symptom that sent me to the contents form — and
  `.gitignore:17:!reports/gs-*.md` after it, which is the negation matching and therefore the file no
  longer ignored. `reports/coverage/index.html` and `reports/mutation.html` both still resolve to
  `.gitignore:16:reports/*`, so the negation did not widen past the prefix.
- **A note on the instrument, because it misled me once.** `git check-ignore -v` exits 0 whenever any
  rule matches, a negation included, so "it printed a rule" is not "it is ignored". Read the rule it
  names, or ask `git add` and `git status`.
- **Verified 2026-10-27.** `node scripts/gs-cascade-check.mjs` passes with this ADR present and its
  row added to `.claude/adr/index.md`, which is the gate that would have failed had the row been
  omitted (step 2, every active ADR resolves to an indexed file).
- The claim this ADR cannot verify from here: that the harness accepts the file. `gs status` reporting
  a step past `02-gs-audit` is the only evidence that counts, and it is recorded in the session that
  follows this commit, not in this one.
