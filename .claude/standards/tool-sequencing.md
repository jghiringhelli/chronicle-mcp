---
node: tool-sequencing
type: sentinel-node
scope: which tool to reach for, in what order, and what each failure means
load: on-demand
categories: [tool-sequencing]
routes_to: [root]
---

# Tool Sequencing

> A tree that lists tools but never says *when* to prefer one forces the agent to guess,
> and guessing is where drift enters. This node states the order. It is normative:
> **MUST** closes the choice, **SHOULD** is defeasible with a recorded reason.

---

## 1. Before reading — orient

| Order | Do this | Not this | Why |
|---|---|---|---|
| 1 | Read `CLAUDE.md` → `.claude/index.md` → `.claude/core.md` → `.claude/ledger.md` | Grepping the repo to work out what it is | The ledger carries corrections already made; skipping it repeats them |
| 2 | Read the **one** domain node the router names | Loading every node under `.claude/standards/` | Sibling nodes cost context and activate irrelevant priors |
| 3 | Read the ADR for the area you are about to change | Proposing a structural change first | ADRs are closed decisions; re-opening one silently is the drift |

A task that spans two domains MUST name both before loading both.

---

## 2. Before searching — semantic first, literal second

1. **`mcp__codeseeker__codeseeker`** for any conceptual query — *"where is X handled",
   "is there already a utility that does Y", "what calls into Z"*. Grep misses
   conceptually identical code under different names, which is how duplicate utilities
   appear.
2. **Grep / Glob** only for an exact literal: a known symbol name, an error string, a
   config key.
3. **`read_page` of a whole file** only after one of the above narrowed it to a file.

MUST search semantically before writing any new utility function, and before adding any
dependency. Grep is not an AST: for "who implements this interface" or "what is the call
graph", use CodeSeeker, not a regex.

**Failure meaning.** CodeSeeker unavailable → say so, then fall back to grep *and widen
the query* (synonyms, both naming conventions). Do not silently narrow to one spelling.

---

## 3. Before installing — check, then pin

1. Check `package.json` first. Already declared at a compatible major → **stop**, do not install.
2. Same major, older patch → update; same or newer → skip entirely.
3. Different major → only with a recorded reason (ADR or `.forgecraft/exceptions.json`).
4. New runtime dependency → the audit-before-add process in @.claude/standards/protocols.md
   applies, and `pnpm audit` MUST report zero HIGH/CRITICAL afterwards.

**This repo uses pnpm.** `npm install` in this tree produces a second lockfile and a
divergent `node_modules`. MUST use `pnpm`. The `packageManager` field pins the major —
honour it rather than invoking `npx pnpm`.

**Failure meaning.** `ERR_PNPM_OUTDATED_LOCKFILE` → the lockfile and `package.json`
disagree; regenerate the lockfile in its own `chore(deps):` commit, never with
`--no-frozen-lockfile` inside a feature commit. A `node-gyp` / `find VS` error is the
native-binding pitfall, not a code bug — see @.claude/ledger.md.

---

## 4. Before claiming done — the gate order

Run in this order. Each step is cheap relative to the next, so a failure surfaces early.

| Order | Command | Gate | Blocking |
|---|---|---|---|
| 1 | `node scripts/gs-cascade-check.mjs` | cascade / sentinel integrity | yes |
| 2 | `pnpm run typecheck` | types, 0 errors | yes |
| 3 | `pnpm run lint` | import cycles, layer boundaries | yes |
| 4 | `pnpm run test:coverage` | tests green, lines ≥80% | yes |
| 5 | `pnpm run test:mutation` | MSI ≥65% overall, ≥70% changed | yes |
| 6 | `pnpm audit --prod --audit-level=high` | zero HIGH/CRITICAL | yes |

MUST run step 5 immediately after writing each test batch, not only before a release —
the surviving mutants are the assertions that were not written. A clean step 4 with a
failing step 5 is test theater: coverage measures what executed, mutation measures what
was *caught*.

Steps 1–4 and 6 also run as a pre-commit hook (`.githooks/pre-commit`) and in CI
(`.github/workflows/ci.yml`). A hook costs zero context tokens; the same check performed
by hand in-conversation costs a thousand-plus each time. Prefer the hook.

**Failure meaning.** A cascade-check error is never "fix the checker": it names a missing
or orphaned artifact. A mutation survivor is never "raise the threshold".

---

## 5. Recording — which artifact takes the decision

| You are doing | Record it in | Tool |
|---|---|---|
| A new capability, or a structural choice | `docs/adrs/active/ADR-NNN-*.md` | `generate_adr` |
| How one unit is built, beside what it does | `docs/edrs/EDR-NNN-*.md` | copy `docs/edrs/TEMPLATE.md` |
| A bug worth remembering (recurrence-prone, behaviour redefined) | `docs/decisions/YYYY-MM-DD-*.md` | `generate_decision` |
| A correction to how the agent works | @.claude/ledger.md Corrections Log | append a dated line |
| A technology trap | @.claude/ledger.md Known Pitfalls | append what/wrong/right |
| Session state worth carrying forward | Chronicle itself (`chronicle remember`) | this project's MCP server |

MUST NOT use an ADR for a bug post-mortem: ADRs answer "what did we decide over which
alternatives", which is the wrong frame for a defect.

---

## 6. Forbidden sequences

- MUST NOT run `git commit --no-verify`. The hook is the gate; bypassing it makes
  **Defended** score zero regardless of what the hook scripts contain.
- MUST NOT edit implementation code to make a failing test pass when the task scope says
  `NOT IN SCOPE: implementation code`. Facing a red test, the path of least resistance is
  to change the production code — that path is closed by the scope line.
- MUST NOT commit to `master`. Branch first: `feat/`, `fix/`, `chore/`, `docs/`.
- MUST NOT write a status line without an execution record under `docs/evidence/`.
