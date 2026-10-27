# The advisory audit blocks a publish, not every commit

**Date:** 2026-10-27 · **Kind:** non-architectural, implements ADR-017 rule 1
**Touches:** `package.json` (`prepublishOnly`), `scripts/check-dependency-policy.mjs` (rule 10),
`docs/dependency-policy.md` (rules 1 and 10)

## What was wrong

`docs/dependency-policy.md` rule 1 says a new HIGH advisory "blocks the build". `prepublishOnly`
ran `release:check && gates && build && smoke`, and `gates` ends in `deps:policy` — which is the
**approved-library** check, not the advisory check. Ten scripts in the publish chain and not one of
them ran `pnpm audit`. So the one build where blocking actually protects somebody was the only build
rule 1 did not block.

This was not hypothetical for even a day. On 2026-10-27 two unignored HIGH advisories were live in
this lockfile — zod `GHSA-mrhx-c7xc-m3w5` (memory exhaustion on oversized input) and body-parser
`GHSA-27r3-jxmh-p828` (denial of service via trailing bytes after a compressed body) — while
`prepublishOnly` was green. v0.5.0 is the next action in this project.

## The decision

**Add `audit:supply-chain` to `prepublishOnly`, and deliberately not to `gates`.**

It sits second, right after `release:check`, so a publish with an open advisory dies in about
fifteen seconds instead of after coverage, build and smoke.

## Why not in `gates`

`gates` is the per-change gate: `.githooks/pre-commit` runs its members at commit time and CI runs
them on every push. An advisory, uniquely among everything `gates` checks, **can appear with no
change to this repository at all** — it is a third party publishing a sentence about code that was
already installed. That has now happened twice on record here: 2026-09-29, which turned the nightly
CI run red for 27 unattended nights, and 2026-10-27, these two.

Put the audit in `gates` and the next such publication blocks an unrelated commit. The developer's
options at that moment are to curate the allow-list under time pressure or to reach for
`--no-verify`, which `.claude/standards/tool-sequencing.md` §6 forbids and which this design would
make tempting. `.claude/ledger.md` already carries the general form of that mistake: a gate people
cannot act on is a gate they stop reading.

The split that follows is: **detect on push, block on publish.**

- Detection is already in place and is not weakened. The `supply-chain` CI job has no event gate —
  it runs on `push` and `pull_request` — so a new advisory still turns the badge red on the next
  push to any branch. It caught these two.
- Blocking belongs at the irreversible step. A commit can be amended; a version on npm cannot be
  unpublished in any way a consumer's lockfile will notice.

## What this does not do

Three limits, stated rather than implied:

- `npm publish --ignore-scripts` skips `prepublishOnly` entirely, and so does publishing from a
  checkout where `pnpm install` never ran. This gate is a seatbelt, not a lock.
- It inherits rule 1's allow-list. An advisory on `pnpm.auditConfig.ignoreGhsas` does not block a
  publish, by design — that is what the list is for, and rule 1's requirements (transitive,
  annotated, recorded in an ADR, re-checked on every SDK bump) are what keep it honest.
- It says nothing about `moderate` or `low`. The gate is `--audit-level=high`, unchanged; ADR-017
  rejected lowering it to `critical` and this does not revisit the threshold in either direction.

And one consequence that is new rather than a limit: **`prepublishOnly` now needs the network.**
`pnpm audit` queries the registry, so an offline publish attempt fails where it used to succeed.
That is the right answer — "I could not check for advisories" is not a reason to ship — but it is a
behaviour change, and it is the only step in the chain with that property: `release:check`,
`cascade`, `typecheck`, `lint`, `test:coverage`, `deps:policy`, `build` and `smoke` are all offline.
The failure will read as a network error rather than as a policy refusal, which is worth remembering
the first time it happens on a plane.

## How it is kept

Rule 10 of `docs/dependency-policy.md`, checked by `scripts/check-dependency-policy.mjs`, which
resolves the publish chain transitively and fails when **no** script it reaches runs an audit. It
asks the property, not the mechanism — the rule was verified by moving the call into `gates`
instead, where it also passes — so a later rearrangement of the scripts cannot quietly undo this
while leaving the rule green. It was made to fail on purpose first: before the fix it reported

```
rule 10: no script the publish chain reaches runs an advisory audit, so rule 1 does not block a
publish. Reached: prepublishOnly → release:check → gates → build → smoke → cascade → typecheck →
lint → test:coverage → deps:policy.
```

which is the evidence that the rule can fail, and therefore that its passing means something.
