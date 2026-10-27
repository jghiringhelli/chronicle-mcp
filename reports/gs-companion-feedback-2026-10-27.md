# gs-companion field report — chronicle, 2026-10-27

Second field report on gs-companion, after Restored Glory's of 2026-10-26 (beta.6, a GameMaker
project). This one is a TypeScript/pnpm MCP server on Windows, run as real work rather than a demo:
the plugin took the repository from brownfield step 01 to step 03 and three commits landed as a
result. **Twelve frictions and four requests.** Every file:line below exists; every quoted string is
the text as it came out.

*Format note: I could not read `reports/gs-companion-feedback-2026-10-26.md` — it lives in the
Restored Glory repository, not here — so this follows the seven sections asked for rather than
copying that report's layout. EDR-031 suggests the shape is the same: numbered frictions, each with
a checkable cause.*

---

## a. Version and environment

| | |
|---|---|
| Plugin | `gs-companion@pragmaworks-local` **2.0.0-beta.9**, enabled in **both** `local` and `user` scope |
| Read from | `C:\workspace\PragmaWorks\gs-companion-2` — a local marketplace directory, not a published package |
| Server identity | `serverInfo: {"name":"gs","version":"2.0.0-beta.9"}` (from `initialize`, driving the build over stdio) |
| OS | Windows 11 Home 10.0.26300, win32-x64 |
| Node / package manager | Node v24.18.0 · pnpm 10.15.0 (`packageManager` pinned in `package.json`) |
| Shells | Git Bash (POSIX) and PowerShell 5.1 |
| Hooks declared | `SessionStart`, `PreToolUse` (`Edit\|Write\|MultiEdit\|NotebookEdit`), `Stop` — `hooks/hooks.json` |
| MCP server | `node ${CLAUDE_PLUGIN_ROOT}/dist/hosts/claude-code/server.js` — `.mcp.json` |
| Target repo | `chronicle` at `45b68e2` on `pilot/companion-2026-10`; 270 tracked files, 16,139 lines of source |
| Repo hooks | its own, via `core.hooksPath = .githooks` — `commit-msg`, `pre-commit`, `pre-push`, `employer-guard` |

### The version reading, and what it says about installing from a directory

The first `claude plugin list` reported **2.0.0-beta.2** in both scopes. That was not a stale install
and `claude plugin update` would not have fixed it. The plugin's source directory was **mid-rebase**:

```
$ git -C C:/workspace/PragmaWorks/gs-companion-2 branch
* (no branch, rebasing feat/checkpoints)
$ cat .git/rebase-merge/msgnum .git/rebase-merge/end
4
73
```

At step 4 of 73 the checked-out tree held an older `.claude-plugin/plugin.json` (beta.2) while
`package.json` already read beta.9. The rebase finished at 13:52:54 —
`rebase (finish): returning to refs/heads/feat/checkpoints` in the reflog — and the next
`claude plugin list` read **2.0.0-beta.9** in both scopes, with no update command and no session
restart.

**Request 1.** For a plugin installed from a working directory, the version Claude Code reports is
whatever that directory holds at the moment of the read, including an intermediate state of
someone else's rebase. That is worth one line in the install documentation, because the failure looks
exactly like a stale install and the obvious remedy (`claude plugin update`) is a no-op against it.

**Also observed:** nine live `gs` server processes, started between 2026-10-24 18:09 and 2026-10-27
13:52, all running `dist/hosts/claude-code/server.js`. Stdio servers appear to accumulate one per
session without being reaped. Harmless at nine; worth knowing.

---

## b. What the plugin did well

### b.1 The step-02 verifier is the best thing in the product

It does not check that a file exists. It checks **68 named fields** the canonical prompt asks for and
then **validates every citation in the report against the files**:

```
02-gs-audit closed: 68 fields the prompt asks for, present: SECTION 1 — SAVED REPORT CARD; …
  SECTION 1 — SAVED REPORT CARD COMPOSABLE: next step; … SECTION 8 — REMEDIATION PLAN: 15 items,
  each with What: and Why now:; report cites 43 file:line, every one exists
```

Before it said that, it rejected my audit with two lacks, and **one of them was a real defect in my
work that no human reviewer would have caught**:

```
- report cites .claude/index.md:68 (the file has 67 lines)
```

I had written `.claude/index.md:68-73` for the tree-invariants block without reading the file's
length. It is at 62-67. Checking the rest of the report the same way — which I only did because the
plugin showed me the class of error existed — found **four more**: the layer map is at
`.claude/core.md:32-37`, not 28-33; the ledger entry at 45-49, not a 28-46 span that covered
something else. Five bad citations in a document whose whole job is to be checkable.

This is the single most valuable behaviour I have seen from the tool. An audit that cites is worth
nothing if nobody verifies the citations, and the plugin is the only thing in the loop that does.

### b.2 Artifact-map resolution works where it is used

`harnessDir()` (`src/core/artifact-resolver.ts:79-85`) reads `core.hooksPath` and correctly resolved
chronicle's hooks to `.githooks` rather than assuming the default `scripts/git-hooks` — the exact
mistake the earlier F-020 handoff made by hand. And the spec is reported as present-but-unverified
with the markers it lacks, rather than ignored:

```
found docs/spec.md (unverified: docs/spec.md ## Overview; docs/spec.md ## Vision;
  docs/spec.md ## Current Phase: Phase; +26 more)
```

That tells a human *why* the step did not advance. Keep this shape. It is strictly better than
dropping an unrecognised document from the candidate list.

### b.3 The commission is a contract, not a suggestion

`gs step` served the canonical audit prompt with `sha256 7cf7db6658656202ca5c492a37669ac72e7b51b32fb1bbbfae6b59a88923306c`
and its fixture hash, plus 18 evidence lines each carrying the command that produced it
(`history → 65 commits, 5 merges, median 130 lines changed, 19 over 400 lines → git log -200 --numstat`).
The discipline of **"not measured" plus a reason, never a silent default**, is exactly right. §c.1 and
§c.2 are about the reasons being wrong, not about the discipline.

### b.4 It is fast

Three runs each, in process against chronicle:

```
status               89 ms  77 ms  76 ms
step (verify only)   86 ms  83 ms  83 ms
```

Fast enough to honour the instruction to call `status` at the start of every task and after every
commit, which a two-second tool would not be.

### b.5 The GS note tracks real state

Once the note could compute, it was specific and correct:

```
▌GS › GS did: 3 commits since the last note (3 docs); step 02-gs-audit → 03-spec-from-code
```

It counted my commits, typed them, and noticed the step transition. Nothing here is a guess.

### b.6 `checkpoint_record` states its own limit

Its description says: *"this server cannot prove the person typed it, so the record is a claim; the
person must approve this tool call (do not allow-list it)."* A tool that tells you what its own
evidence is worth is rare and is the right default for a verdict record.

---

## c. Frictions

### c.1 Nine of fifteen instruments said `not measured`, and the reasons were wrong — pnpm

**What the user saw**, verbatim, in the step-02 evidence:

```
eslint    → not measured → instrument absent: npm i -D eslint typescript-eslint
tsc       → not measured → instrument failed: ENOENT
coverage  → not measured → instrument failed: ENOENT
madge     → not measured → instrument absent: npm i -D madge
npm-audit → not measured → instrument absent: npm install (no package-lock.json)
gitleaks  → not measured → instrument absent: brew install gitleaks (or https://…)
jscpd     → not measured → instrument absent: npm i -D jscpd
knip      → not measured → instrument absent: npm i -D knip
stryker   → not measured → instrument absent: npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner
```

**What I expected.** chronicle has `eslint`, `typescript-eslint`, `typescript`, `vitest`,
`@vitest/coverage-v8`, `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` in
`devDependencies`, an `eslint.config.js`, a `vitest.config.ts`, a `stryker.config.json`, and scripts
`lint`, `typecheck`, `test:coverage`, `test:mutation`. Four of the nine should have run.

**Cause, measured.** `locateEslint` (`dist/harness/templates/git-hooks/gs-instruments.mjs:36-41`)
requires `resolveFrom(repo, "@typescript-eslint/parser")` **and** `"@typescript-eslint/eslint-plugin"`.
chronicle depends on the umbrella package `typescript-eslint`, and pnpm does not hoist transitive
dependencies into the repository root, so both are unresolvable. A `createRequire(repo/package.json)`
probe:

```
eslint/package.json                    ok
@typescript-eslint/parser              UNRESOLVABLE
@typescript-eslint/eslint-plugin       UNRESOLVABLE
@vitest/coverage-v8                    ok
@stryker-mutator/core                  UNRESOLVABLE
@stryker-mutator/vitest-runner         UNRESOLVABLE
.bin/eslint                            present
.bin/tsc                               present
.bin/vitest                            present
.bin/stryker                           present
```

The binaries are all there; `require.resolve` from the root is the wrong question to ask under pnpm.
`madge`, `jscpd` and `knip` are genuinely absent — those three reports are correct, only the
`npm i -D` wording is wrong for a pnpm repository.

**`npm-audit` is a separate wrong conclusion.** `instrument absent: npm install (no package-lock.json)`
— chronicle has a 192 KB `pnpm-lock.yaml` and `pnpm audit --prod --audit-level=high` exits 0 today
with three advisories allow-listed. A lockfile audit was always possible.

**Request 2.** Decide an instrument is present from `binPath()` (which already handles
`node_modules/.bin`) and treat `resolveFrom` as an optional extra for the config it needs to
generate; detect the package manager from the lockfile and name it in the remedy. Under pnpm, a
present binary with an unresolvable transitive is the normal case, not the broken one.

### c.2 `tsc` and `coverage` got ENOENT — the Windows `.CMD` shim parser does not match pnpm's

**What the user saw:** `tsc → not measured → instrument failed: ENOENT`, with `node_modules/.bin/tsc`
and `node_modules/.bin/tsc.CMD` both present on disk.

**Cause.** `launch()` (`src/harness/templates/git-hooks/gs-env.mjs:15-20`) matches
`/"%dp0%\\([^"]+)"\s+%\*/` against `<bin>.cmd` to find the real script. pnpm's shim does not have
that shape:

```cmd
@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\..\typescript\bin\tsc" %*
) ELSE (
  node  "%~dp0\..\typescript\bin\tsc" %*
)
```

`%~dp0` with the tilde, a `..\` segment, two spaces before the path. No match, so `launch` returns the
**extensionless** `node_modules/.bin/tsc` — a shell script — and `execFile` on Windows answers
ENOENT. Proven by importing the plugin's own function:

```
tsc       SHIM NOT PARSED -> execFile on the extensionless sh script
vitest    SHIM NOT PARSED -> execFile on the extensionless sh script
eslint    SHIM NOT PARSED -> execFile on the extensionless sh script
stryker   SHIM NOT PARSED -> execFile on the extensionless sh script
```

So all four would fail this way even with §c.1 fixed; eslint and stryker only reached the earlier
`absent` branch first.

**Request 3.** chronicle's own `pre-commit` already solves this portably and is worth copying —
`.githooks/pre-commit:52-57` runs `node node_modules/typescript/bin/tsc --noEmit` and
`node node_modules/eslint/bin/eslint.js`, resolving the package's entry script and handing it to
`node` rather than parsing a shim. `tsc --noEmit` that way: **exit 0 in 2 s**. Failing that, match
`%~dp0` too and tolerate the `..` segment.

### c.3 `conventional-commits → 47 of 65` is two measurements reported as one

**What the user saw:** `conventional-commits → 47 of 65 subjects → git log -200 --format=%s`, as an
input to the Auditable grade.

**What is true:** **57** of 65 are valid Conventional Commits with a canonical type. The 10-commit
gap is entirely descriptions of 73–80 characters:

```
valid Conventional Commits (nine types, any length): 57
same, with the 72-char description cap:              47
rejected ONLY for description length:                10
  76 chars  fix(rls): apply the boundary — an app credential can no longer act as anyone else (#5)
  80 chars  feat(security): both partners admin, each with an RLS-confined app role; drop raw pr…
  …
```

The pattern (`scripts/git-hooks/gs-rows.mjs:23`, `.{1,72}`) enforces a length limit that the label
does not mention. I reported this on 2026-10-23 as a *message* defect; this is worse, because here it
corrupts a **measurement** that an auditor uses to grade a repository.

**It then bit this session's own work.** The commit
`docs: Status.md carries the GS contract, and stops contradicting its own evidence` has a 75-character
description, and the Stop checklist printed:

```
▌GS › - [ ] FAIL Commit follows Conventional Commits format
```

for a textbook Conventional Commit. The two other commits, at 72 and 63 characters, passed.

**Request 4.** Report them as two numbers — `conventional-commits: 57 of 65` and
`subject-length: 47 of 57 within 72` — and have row 1 say which one failed, with the count:
`description is 75 characters; the limit is 72`.

### c.4 `status` and `step` disagree about whether `STATUS.md` exists

`status` evidence, every call, including after I committed the file:

```
missing STATUS.md
```

`step`, against the same repository at the same moment, read the headings **out of that file** and
counted its lacks down from 8 to 1 as I edited it:

```
- STATUS.md ## Current Phase — expected a heading line starting with "## Current Phase" in "STATUS.md"
```

git's spelling here is `Status.md` (`git ls-files | grep -i '^status'` → one file, `Status.md`). One
path resolves case-insensitively through the filesystem and reads the file; the other requires the
exact `STATUS.md` spelling and declares it missing. Two code paths, two answers, one artifact — which
is the condition F-020 exists to remove. The Stop checklist shares the strict path:
`- [ ] FAIL STATUS.md updated`, printed after commit `4bde1b8`, whose only changed file was
`Status.md`.

### c.5 Step 03 asks for a document that exists under another name, and the way to adopt it is gated three steps later — **this is the blocker**

**What the user saw:**

```
- docs/spec/SPEC.md is missing — expected a file at that path
```

chronicle's authoritative specification is `docs/spec.md`, and `ADR-013-single-source-spec` makes it
*the* single source — `docs/chronicle-spec.md` is retained for provenance and explicitly must not be
read as current behaviour. Writing a second specification document to satisfy a path is precisely the
failure that step exists to prevent, so I did not write it.

The sanctioned way out is the one the task pointed at, and it is unreachable from here:

```
$ gs step --lock adopt
lock: the harness is not installed (step 06); there is nothing to adopt yet
```

**So at the only step where an existing spec collides, the mechanism for adopting an existing spec is
three steps in the future.** `collapse` is behind the same gate. The result is that a brownfield
repository with a good spec under a different name cannot pass step 03 without either duplicating its
spec or editing the tool.

**Request 5 (the important one).** Let the artifact map be *declared* before step 06 — a
`.gs.json`, or `gs step --remap` working from step 01 — so a repository can say "my spec is
`docs/spec.md`, my status is `Status.md`" once, and have every step and both hooks resolve through
it. That single change fixes c.4, c.5 and c.8, which are three faces of the same thing: paths
hardcoded in the steps while a resolver exists for them.

### c.6 A lack message described the wrong kind of thing, and named a string that appears nowhere

**Verbatim:**

```
- SECTION 1 — SAVED REPORT CARD COMPOSABLE: next step — expected a heading line starting with
  "SECTION 1 — SAVED REPORT CARD COMPOSABLE: next step" (the audit keeps its eight sections, in this order)
```

The **requirement was right**: COMPOSABLE was the one property in my report with no "next step to
raise it". But the explainer says *heading line* for a labelled line inside a section, and the string
it tells you to write is a concatenation of a section name and a property name that occurs nowhere in
the canonical prompt. I worked out what it wanted by elimination — noticing six properties had a next
step and one did not. A reader who trusted the message would have added a nonsense heading.

No `Do:` line was present on these step-03 lacks, so the newer "rejections say what to do" work
(F-032) has not reached the step verifier's output.

### c.7 `STATUS.md sections in the prompt's order` does not say the order

**Verbatim:** `- STATUS.md sections in the prompt's order — expected the headings in the order the
served prompt lists them`.

The six headings were all present; only their order was wrong. The message names the rule and not the
expected value, and the only documented way to get the value is `full: true`, which re-serves the
entire prompt. I inferred it from the order of the earlier eight-lack list and was right, but that was
a guess. A lack that knows the expected order should print it.

### c.8 Both hooks are silent in this repository — which is why no GS note appeared all session

`looksLikeGsProject` (`src/hosts/claude-code/trust.ts:18-20`):

```js
return existsSync(join(repo, harnessDir(repo), "config")) || existsSync(join(repo, "docs/spec/SPEC.md"));
```

chronicle resolves `harnessDir` correctly to `.githooks` (§b.2) but has no `.githooks/config`, and no
`docs/spec/SPEC.md`. Neither disjunct holds, there is no `.git/gs-companion` opt-in marker, so
`sessionStart` and `stop` both return `{}`. Measured as installed:

```
SessionStart  {}   190 ms
Stop          {}   145 ms
```

and `.git/gs-host-hooks.log` does not exist, because nothing ran.

**So the entire F-031/F-033 surface — the marker, the orange line, the GS note, the closing checklist
— is invisible in exactly the kind of brownfield repository it was built for**, until step 06 writes
a config file, which step 03 is blocking. The second disjunct is also a hardcoded path while the first
one consults the resolver; the spec test should go through the map, where `docs/spec.md` was already
found.

### c.9 Duplicated evidence lines, still present

One `status` result:

```
found reports/gs-audit-2026-10-27.md
found reports/gs-audit-2026-10-27.md
found docs/spec.md (unverified: …)
…
found docs/spec.md (unverified: …)
```

Two checks emit the same `found` line and nothing de-duplicates. Reported 2026-10-23 against the
control repository; pre-existing and cosmetic, but it now makes a six-line evidence block read as
eight.

### c.10 The Stop hook costs ~3.4 s with the suite skipped, and runs the suite when it is not

Measured in process, `handleHook("Stop", …, { skipSuite: true })`: **3,398 ms**. Without that option —
which the CLI entry point does not expose — the closing checklist runs the repository's declared test
suite at every Stop. chronicle's suite is 10.6 s. A per-turn cost of 3.4 s is noticeable; 14 s is not
acceptable, and the only way to avoid it today is to not opt in.

### c.11 `next step: ---`

Before I added the heading, the Stop note printed:

```
▌GS › next step: ---
```

`nextStep()` (`src/hosts/claude-code/hooks.ts:163-169`) does `findIndex` for
`## Next Session Entry Point`, gets `-1`, and then `lines.slice(heading + 1)` is `slice(0)` — so it
scans from line 1 of the file and returns the first non-empty line, which in chronicle's `Status.md`
is `---`, the YAML frontmatter opener. The function has a correct fallback string, `"see STATUS.md"`,
that this path can never reach. Guarding `heading < 0` is a one-line fix.

### c.12 Replayed `cold-read` evidence carries a stale claim as present fact

The step-02 commission included, undated, inside the evidence handed to the auditor:

> *"One thing to know: `CLAUDE.md` and everything under `.claude/` show as deleted in your working
> tree. I read the committed docs instead."*

That was true on 2026-10-17 and is false now — both are present and tracked. A recorded observation
replayed into a later commission needs its date attached, or a fresh reader treats a month-old
accident as a current property of the repository.

---

## d. The visible output

**The marker, in tool results: correct by design, and never arrives in this host.**
`src/hosts/claude-code/marker.ts:1-4` states the intent — marker only in tool results, orange only in the hooks' `systemMessage`, because
"tool results and the menu are text the model reads". Driving the build by hand over stdio returns
exactly that:

```json
"▌GS › 02-gs-audit — next: Run `gs step`: the tool commissions the GS Audit (pragmaworks.dev/audit)…"
```

But the same call **through Claude Code's MCP client** returns:

```json
{"step":"02-gs-audit","nextItem":"Run `gs step`: …","evidence":["found docs/spec.md (…)",…]}
```

The server returns both `content[0].text` (marked) and `structuredContent`, and this host surfaces
`structuredContent`. So the marker never reaches the model through a tool result here, and F-031's
tool-result half is inert in Claude Code. Every `▌GS ›` I passed on to the user this session, I typed
myself from the structured data.

**Orange: present, correct, and raw in the JSON** — one escape pair per line, which is what the host
expects to render:

```
"\u001b[38;2;255;140;0m▌GS › GS did: first note in this clone; it tracks from here\u001b[0m\n…"
```

`NO_COLOR` support is in `src/hosts/claude-code/marker.ts:9` and I did not exercise it. **I never saw the orange rendered in
the terminal**, because the hooks return `{}` in this repository (§c.8); the capture above is from
driving `handleHook` directly with the opt-in forced.

**Short on a quiet turn, long on a commit: could not confirm, and there is a reason it may never be
short.** In every probe the note came out in the long form, because `closesWork()`
(`gs-note.js`, EDR-033) returns true when the tree is dirty — and chronicle's tree has six modified
files that are not part of this work. A repository with any uncommitted change therefore gets the long
note on every turn, quiet or not. The three-line form is reachable only with a clean tree, no new
commit and no newly failing item.

**Did the GS note appear in every turn? It appeared in none.** Zero notes in a session of roughly
forty turns, for the reason in §c.8.

**`Next:` — generic once, useful once, and the source line tells you which.** First probe:

```
▌GS › Next: Pick the next feature and write its specification before any code. (Compendium §8.1)
```

Generic, and **contradicting `status`**, which at that moment said the next item was to commission the
GS audit. Telling someone at step 02 to write a feature spec is advice from a different project. Second
probe, after the commits:

```
▌GS › Next: Generate docs/spec/SPEC.md and STATUS.md from the code (pragmaworks.dev/brownfield, step 03). (status)
```

Specific and correct. The difference is the parenthesised source: `(status)` came from the step
machine, `(Compendium §8.1)` from the next-action table. **Prefer the step machine when it has an
answer** — a table entry that disagrees with the current step is worse than no suggestion, because the
note is the thing the person reads instead of the tool output.

---

## e. What the plugin asked for that was superfluous, and what was missing

**Superfluous: nothing in kind.** Every artifact the steps asked for is one this repository should
have. The over-specification is in the **paths**, not the artifacts: `docs/spec/SPEC.md` and
`STATUS.md` as literals, when a resolver for both already exists in the same codebase (§c.5).

**Missing — four things, in order of how much they cost here:**

1. **A way to declare the artifact map before step 06.** Requests 5. This is the whole of c.4, c.5 and
   c.8.
2. **Repository-declared commit types.** chronicle deliberately uses `spec:` and `release:` alongside
   the nine. Eight of its 65 subjects are non-canonical and four of those are `spec:`. There is no way
   to declare them, so the repository must either accept a permanently imperfect row-1 number or
   rewrite its history. F-002 gives *gates* a baseline of inherited debt that can only shrink; the
   **rows have no equivalent**, which is the same gap I flagged on 2026-10-23.
3. **A `Do:` line on the step verifier's lacks.** F-032 reached the harness rejections and not these.
   §c.6 and §c.7 are both messages that name a rule without naming the expected value.
4. **A `skipSuite` equivalent on the hook CLI entry.** `handleHook` takes the option; `hook.js` cannot
   pass it, so there is no way to opt into the hooks without also paying for a full test run per turn
   (§c.10).

---

## f. What I did not measure

- **Steps 04–08.** The walk stopped at 03. So: the harness install at step 06 and its
  `production-paths` / `codeowners-routes` decisions, the `project-type` answer the task asked me to
  give at 06, `remap`, `lock: adopt` past its gate, `collapse`, `lane open` / `lane integrate`, and
  `checkpoint_record` (F-019) are all untested by me.
- **The GS note as the person actually sees it.** Every capture in §d came from driving `handleHook`
  in process with the opt-in forced. I never saw a rendered orange line in this terminal, so I cannot
  report on how it looks among Claude Code's own output, whether it wraps, or whether the escape
  survives.
- **The three-line quiet note.** Not reachable with this tree (§d).
- **`PreToolUse`.** No production code was edited in this session — the audit prompt forbids it — so
  the row warnings, the 300 ms budget and the checkpoint warn-mode line never fired.
- **`coverage` and `stryker`, even by hand.** The coverage run was stopped for low system memory
  earlier in this session and I was told not to restart it unprompted. The suite itself ran green via
  the pre-commit hook (314/314); the percentages did not.
- **`madge`, `jscpd`, `knip`, `gitleaks`.** Genuinely not installed here. Duplication, dead code, an
  independent cycle check and a real secret scan are unmeasured, in the audit and here.
- **Whether `claude plugin update` does the right thing** against a directory install. Never needed
  it (§a).
- **Which of the nine live server processes answered my tool calls.** The data they returned matches
  beta.9's output exactly, including the em-dashed evidence strings, but I cannot prove which process
  it was.
- **`NO_COLOR`**, and the plugin's behaviour in a non-GS repository other than by reading `trust.ts`.
- **The oracle tests of gs-companion itself.** I did not run its suite; I only read its built output
  and imported three of its functions.

---

## g. What is governed now, and what is not

**Stopped at: step `03-spec-from-code`, one lack remaining —** `docs/spec/SPEC.md is missing`.

### Moved this session

| | Before | After |
|---|---|---|
| GS step | `01-cold-read` (2026-10-17), `02-gs-audit` (2026-10-23) | **`03-spec-from-code`**, step 02 **verified** |
| Step 02 | not measured | closed: 68 fields present, 43 citations checked |
| Audit | none | `reports/gs-audit-2026-10-27.md` — B- SAVED, C+ engineering |
| `Status.md` | 47 days stale, contradicting its own evidence | current, carrying the six GS headings in order |
| Ratchet floors | believed 41.17 / 20.67 | documented as 41 / 20 against measured 59.98 / 36.92 |
| Suite | unverified against SDK 1.32.1 | **314/314 green** at `09d68e5` |

Three commits, all through the repository's own gates, none with `--no-verify`:
`09d68e5` the audit and ADR-025 · `e020a6f` the citation fixes · `4bde1b8` Status.md.

### Genuinely governed

- **The audit exists, is committed, and is checkable.** 43 citations verified by a tool, not by me.
  `ADR-025` records why a `reports/` file is tracked when `.gitignore` says otherwise, including that
  the first version of the rule was silently inert because git cannot re-include a file whose parent
  directory is excluded.
- **`Status.md` is a GS status document now** — Current Phase, Brownfield Baseline with the step-02
  grade line, Last Session, In Progress, Completed, Next Session Entry Point — and it no longer
  disagrees with the evidence it cites.
- **The remediation plan is on file:** fifteen items in leverage order, the contract for the sessions
  that follow.
- Pre-existing and now mapped rather than re-created: 20 active ADRs, 4 EDRs, the sentinel tree with
  enforced read budgets, four git hooks under `.githooks`, seven CI jobs, 24 test files, five
  integration verifiers in `scripts/`.

### Not governed

- **The spec is not adopted.** `docs/spec.md` is unverified against the 29 markers the step wants, and
  cannot be adopted until step 06. The harness, the CODEOWNERS routes, the declared production paths,
  the spec lock and the phase collapse all sit behind that.
- **No size limit is declared anywhere an instrument reads.** `docs/spec.md` has no `## Quality Gates`
  section, so `maxFileLines` and `maxFunctionLines` are null and the gates that need them are skipped
  with a note. This is audit item 3 and it is also what step 06 would ask for.
- **Both hooks are inert** (§c.8). Nothing warns at edit time, nothing closes a session, and the GS
  note does not exist in this repository.
- **The four audit Gaps are open:** `prepublishOnly` not running `pnpm audit`;
  `src/mcp/team-gate.ts:28` failing open; the function-length hook that cannot fail; `commit-msg`
  exiting 0 when its delegate is absent.
- **Coverage and mutation are 45 days old**, and the ratchet floors are two measurements behind, so
  roughly 19 points of line coverage can regress unnoticed.

### If one thing gets fixed

**Request 5.** Let the artifact map be declared before step 06. Three of the twelve frictions and the
single blocker are the same defect: the steps and `trust.ts` hardcode paths that a resolver in the
same codebase already knows how to find. chronicle is a well-governed repository that the tool cannot
govern, for no reason other than that its spec is called `docs/spec.md`.
