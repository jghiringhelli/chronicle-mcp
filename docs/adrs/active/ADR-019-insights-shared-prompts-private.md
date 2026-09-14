---
id: ADR-019
type: adr
status: active
tier: T1
properties: [defended, auditable, self-describing]
obligations: 10
depends_on: [ADR-018, ADR-002]
---

# ADR-019: Insights are shared, prompts are not — and isolation is enforced by the database

**Date:** 2026-09-11
**Status:** Accepted
**Supersedes:** the `share_content` / `raw_content` opt-in on prompt logs

## Context

Two findings made the previous privacy model untenable for a shared database.

**Isolation was client-side only.** Every client connects with the raw `railwayUrl`, which for this
Railway project is the `postgres` superuser string. Separation between people is a `WHERE user_id =
${config.userId}` in application code, and the cloud schema has **no row-level security, no roles and
no grants** — verified. For a second person to use the mirror they need that same credential, and with
it `SELECT * FROM memories` returns everyone's rows. Personal memories would sit in a database the
partner holds superuser credentials for, with the only barrier being a filter in a client they can
replace.

**Raw prompt text was capturable.** `prompt_logs` carries `raw_content` behind a `share_content` flag
defaulting to false. Nothing has used it — measured: 1 row in the live table, `share_content: false`,
zero rows carrying raw content anywhere. But a flag is a guarantee only as strong as everyone who can
flip it.

The industry splits cleanly on the second point, and the split is informative:

- **Coding assistants avoid the question.** GitHub Copilot Business/Enterprise administrators cannot
  view, export or access prompts, inline suggestions, chat conversations or generated code through any
  dashboard, API or audit log; telemetry is deliberately separated from content, and prompts are not
  retained once a response is returned. Admins see aggregates — seats, active users, languages.
- **Enterprise chat products answer it deliberately.** ChatGPT Enterprise's Compliance API exposes
  conversations, uploads, memories and metadata with eDiscovery and DLP integrations; Claude
  Enterprise's Compliance API (May 2026) exposes chat content, uploads and projects to compliance
  reviewers. They do not dodge the legal exposure — regulated customers *require* legal hold, so it is
  gated behind a compliance role and disclosed contractually.

Chronicle belongs to the first category. Its value, stated plainly by its author, is *"las lecciones
aprendidas, la lógica de desarrollo, los problemas resueltos"* — the derived lesson, not the
transcript. So the transcript is pure liability with almost no upside.

## Decision

### 1. The unit of sharing is the insight, never the prompt

Chronicle MUST NOT store raw prompt text, anywhere, at any scope. The `share_content` flag and the
`raw_content` column are **removed**, not defaulted off.

A flag that can be flipped is a promise; an absent column is a property. This is the discipline of
removal: delete the freedom to be wrong rather than document the right choice.

What a prompt log keeps is what makes a pattern derivable:

| Kept | Removed |
|---|---|
| `pattern` — what the prompt was *trying to achieve*, in the author's words | `raw_content` — the prompt itself |
| `outcome` — good / bad / neutral | `share_content` — the opt-in that made raw capture possible |
| `category`, `tags`, `project`, `logged_at` | |

The live row demonstrates the difference: its `pattern` reads *"GS audit of SafetyCore Pro harness —
evaluated 7 specification…"*. That is a lesson. The prompt that produced it is not needed to learn
from it.

### 2. Nobody reads another person's prompt logs. Not even an admin

Prompt logs are **owner-only**. There is no admin read path, no project-admin exception, no
team-lead exception.

This follows the Copilot precedent rather than the compliance-API one, for a reason that is about
what this tool is: a memory aid a developer talks to candidly. An admin-visible prompt log changes
what people are willing to write down, which destroys the data before any privacy question arises.
What crosses to the team is the **aggregate**: counts by outcome and category, and the patterns
distilled into `team_insights` — which is what `team stats` already returns.

### 3. Isolation is enforced by Postgres, not by the client

Row-level security on every person-scoped table (`memories`, `insights`, `session_summaries`,
`sync_cursor`, `prompt_logs`), with one Postgres **role per person**:

- A person's role MAY read and write only rows where `user_id` matches its own identity.
- Team tables (`teams`, `team_members`, `team_shared_memories`, `team_insights`, `team_patterns`) are
  readable by every role belonging to that team — that is what makes them team tables.
- `team_licenses` is readable only by the owner role; a token is a credential, not team knowledge.
- Each person's `railwayUrl` MUST use their own role. The `postgres` superuser string MUST NOT be
  distributed, and MUST NOT be what a client is configured with.
- The client-side `WHERE user_id = …` filters stay. Defence in depth: the database is the boundary,
  the filter is the intent, and a mismatch between them is a bug worth catching.

### 4. Project scope is not automatically team-visible

A `project`-scoped memory syncs across **its author's** machines. It becomes visible to teammates only
through an explicit act — `team share` for one memory, or `team promote` for a reviewed batch.

This is the answer to "is project scope shared?": no, not by default. The three scopes in ADR-018 are
scopes of *relevance*; crossing to another person is always deliberate. A repository is not a
permission: two people working one repo may still hold context about it that is theirs.

## Alternatives Considered

- **Keep `raw_content` opt-in and default off.** Rejected. It is the current state, and the current
  state is a flag protecting the most sensitive field in the system. Nothing uses it, so removal costs
  nothing measurable.
- **Keep raw content but encrypt it client-side.** Rejected for now: it buys privacy on shared storage
  at the cost of making the content unsearchable server-side, and the content is not worth that. Worth
  revisiting only if raw transcripts turn out to have value the `pattern` field cannot carry.
- **Give project admins read access to prompt logs.** Considered seriously — it was the author's own
  open question. Rejected on the Copilot precedent plus a behavioural argument: a log someone else
  might read is a log people curate, and a curated log of mistakes is worthless. The compliance-API
  model exists for regulated enterprises under contract, which is not this.
- **One shared superuser credential, document the trust assumption.** Rejected. It is defensible for
  two trusted partners and it does not survive a third member, a contractor, or a leaked `.json`. RLS
  costs one migration and removes the class.
- **Separate Postgres database per person.** Rejected: it isolates perfectly and makes the team tables
  impossible, which is the feature.

## Consequences

**Positive.** A teammate with a valid credential cannot read another person's memories even by
bypassing the client, because the database refuses. Raw prompt capture is structurally impossible, so
the legal surface the author worried about does not exist. The team layer keeps working on exactly the
data it should: shared memories and distilled insights.

**Negative.** Provisioning is now a real step: a role per person, created by an owner, and each person
must configure their own `railwayUrl`. That is friction at onboarding, and it means the current
configuration — superuser string — must be replaced on both machines. Until that happens, RLS is
defined and not in force, because a superuser bypasses it by definition.

Removing `raw_content` is a breaking schema change for anyone who enabled it. Measured: nobody has, so
the blast radius is zero today and will not be later.

The owner role retains superuser-adjacent power by necessity — someone must be able to run the
migration and mint roles. That is a real residual: the owner can read everything if they choose to use
the superuser credential rather than their own role. The mitigation is procedural, not technical, and
saying so is better than implying otherwise.

## Verification

- `scripts/apply-rls.mjs` — idempotent migration that enables RLS and creates the policies; reports
  what it changed.
- `scripts/verify-isolation.mjs` — connects **as one person's role** and asserts that another person's
  rows are invisible and unwritable. An isolation claim that has not been tested from the other side
  is not a claim.
- `tests/unit/services/prompt-log-service.test.ts` — asserts no raw content is retained.
- **Not verified until both machines are reconfigured:** that the superuser string is no longer in use
  anywhere. RLS does not apply to superusers, so this ADR is only in force once the credentials change.
