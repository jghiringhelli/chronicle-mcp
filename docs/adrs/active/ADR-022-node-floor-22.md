---
id: ADR-022
type: adr
status: active
tier: T1
properties: [defended, verifiable, auditable]
obligations: 5
depends_on: [ADR-015, ADR-017]
---

# ADR-022: Raise the supported Node floor to 22, and gate the claim instead of asserting it

**Date:** 2026-09-12
**Status:** Accepted
**Amends:** `package.json` `engines.node`, the CI Node matrix, and `docs/dependency-policy.md`
(adds rule 9). **Corrects** ADR-015's Verification section.

## Context

The first CI run of this branch failed, on the one job whose entire purpose is to catch this:

```
Native binding loads (ADR-015 - the NAPI claim, not an assumption)
  Segmentation fault (core dumped) node -e "const D=require('better-sqlite3') ..."
  Process completed with exit code 139.
```

Node 24: green. Node 20: **segfault**.

`better-sqlite3@13` declares `engines.node: ">=22"`. Version 12 declared
`20.x||22.x||23.x||24.x`; the major bump raised the floor, and this package went on claiming
`>=20`. Neither pnpm nor npm treats an engine mismatch as an error by default, so it installed
cleanly and then crashed -- exit 139, no stack, no message. For a tool whose entire value is not
losing what you wrote down, that is the worst available failure mode.

Three things about how this was found are worth recording.

**It was invisible locally, by construction.** This machine runs Node 24. 283 tests, the mutation
gate, the cascade check, the smoke test and the NFR benchmark all passed on it, and none of them
could have found this. The only instrument that could was a second Node version, and the only place
a second Node version exists is CI.

**ADR-015 built that instrument and then mis-stated what it proved.** It introduced the matrix with
the reasoning that `engines.node: ">=20"` would be *"tested rather than asserted"* -- correct, and
the matrix duly falsified the claim the first time it ran against a driver whose floor had moved.
What ADR-015 got wrong was its Verification section, which recorded the range as verified when the
matrix had not yet run on any branch containing `@13`.

**Rule 7 of the dependency policy passed this.** Rule 7 reasons about *prebuild style*: a Node-API
package may have an open lower bound, a per-ABI package needs a closed interval. That is still true
and it is orthogonal to the defect. `>=20` was the right *shape* and the wrong *number*. The rule had
no opinion about where an open bound starts, so the gate printed `dependency-policy: ok` while the
package promised a runtime it segfaulted on.

Node 20 reached end of life on 2026-04-30, four months before this was written, which is worth
stating plainly: nothing of value is being dropped. The defect was never that Node 20 was
unsupported -- it was that the package said it was supported.

## Decision

1. **`engines.node` becomes `>=22`.** It is what the dependency requires and what is tested.
2. **The CI matrix becomes `['22', '24']`** -- the floor of the supported range and the current LTS.
   A matrix that does not include the floor is not testing the claim, which is how `>=20` survived
   until the day the matrix included 20.
3. **Dependency-policy rule 9**: the lower bound of `engines.node` MUST be at or above the lower
   bound every runtime dependency declares. Gated by `scripts/check-dependency-policy.mjs`, reading
   the installed tree, so it is offline, deterministic, and describes what this lockfile actually
   produces. Rule 7 governs the shape of the range; rule 9 governs where it starts. Both are needed,
   and the gap between them is this defect.
4. **The runtime states its own requirement.** `src/shared/runtime.ts` holds the floor and the check;
   `src/shared/assert-runtime.ts` is a side-effect guard imported first in `cli.ts`. An unsupported
   Node now gets four lines naming the version, the reason and what to do, on **stderr** -- stdout is
   the MCP stdio transport, and a diagnostic written there is parsed as a malformed protocol frame,
   making the client report something unrelated to the real problem. `engines` alone cannot do this:
   it is advisory by default, and `npx`, a global install or a vendored copy bypasses it entirely.
5. **`cli.ts` reaches the native code through `await import('./mcp/server.js')`.** This is the
   load-bearing half of the guard. ES modules evaluate static imports in declaration order, so a
   static import of the server would make the guard's effectiveness depend on that order surviving
   every future reformat, import sorter and bundler -- and a regression would surface as a segfault
   on someone else's machine, not as a red test here. A dynamic import cannot be hoisted above the
   guard by anything.

## Alternatives Considered

- **Pin `better-sqlite3` to `^12` to keep Node 20.** Rejected, and it is the tempting option because
  it changes one line. `@12` carries an `install` script (`prebuild-install || node-gyp rebuild`)
  and per-ABI prebuilds -- precisely what ADR-015 removed, because this machine has no C++ toolchain
  and the fallback path fails at install with an error that reads like a code bug. It would trade a
  real segfault on an EOL runtime for a reinstated install hazard on every runtime.
- **Keep `>=20` and document the caveat in the README.** Rejected. `engines` is read by installers,
  not by people, and the symptom is a segfault -- prose cannot reach anyone staring at
  `Segmentation fault (core dumped)`.
- **Remove Node 20 from the matrix and say nothing.** Rejected as the worst option available: it
  deletes the instrument that found the defect in order to stop it reporting. The matrix is the only
  reason this was caught before a user caught it.
- **Only raise `engines.node`, without the runtime guard.** Insufficient. An engine mismatch is a
  warning by default in both npm and pnpm, so the claim would be correct and still unenforced.
- **Only add the runtime guard, without rule 9.** Insufficient in the other direction. The guard
  catches *this* floor; rule 9 catches the *next* time a dependency raises its own -- which is how
  this happened: silently, in a major bump, on a transitive property nobody re-reads.

## Consequences

**Positive.** The supported range is now a tested claim at two levels: rule 9 checks it against the
installed tree before anything runs, and the matrix runs the floor. The worst failure mode -- a
native segfault with no diagnostic -- is replaced by a message naming the cause. Node 22 also makes
available language features this codebase had been avoiding for a floor nobody was testing.

**Negative.** Anyone still on Node 20 must upgrade to use Chronicle. Given that Node 20 went EOL in
April 2026 and the alternative was a segfault, that is a cost on paper rather than in practice.

The floor is now written in three places -- `MINIMUM_NODE_MAJOR`, `engines.node` and the CI matrix --
and three copies of a number is exactly the duplication this project keeps having to guard against.
`tests/unit/shared/runtime.test.ts` reads all three and fails if they disagree, which is the only
thing making the duplication acceptable. Raising the floor again means changing all three together;
the test names the other two when it fails.

`cli.ts` now carries an ordering constraint that a reader must not "tidy up". The comment says so and
the test enforces it, because a comment alone would not have survived.

## Verification

- **The defect itself**, on the real instrument: run `34737893279`, job *Types, lint, tests
  (Node 20)* -- `Segmentation fault (core dumped)`, exit 139, while Node 24 passed every gate in the
  same run.
- **Rule 9 catches it.** Reverting `engines.node` to `>=20` and running
  `node scripts/check-dependency-policy.mjs` exits 1, naming the dependency, both floors and the
  remedy. Restoring it exits 0. Run both ways before this was committed, not reasoned about.
- `tests/unit/shared/runtime.test.ts` -- 15 tests: three-way parity of the floor, the floor against
  every runtime dependency's own `engines`, the message content on `20.19.4`, that an unparseable
  version is *allowed* rather than refused, that the guard is the first static import in `cli.ts`,
  that `./mcp/server.js` is reached dynamically, and that the diagnostic goes to stderr.
- `scripts/smoke-mcp.mjs` check 18 -- the guard survives bundling. It is a side-effect-only import,
  the category a bundler is most likely to drop, and a dropped guard produces no failing test at all,
  only exit 139 somewhere else.
- **Not verified:** the guard's message has not been observed on a real Node 20, because none is
  installed here and the matrix no longer includes one. What is verified is the check that produces
  it, at the boundary (`20.19.4` refused, `22.0.0` allowed). Running the built CLI under Node 20
  would need a container, and the value of that over the unit test is small.
