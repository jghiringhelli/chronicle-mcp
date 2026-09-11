---
id: ADR-020
type: adr
status: active
tier: T1
properties: [defended, auditable]
obligations: 7
depends_on: [ADR-019]
---

# ADR-020: Both partners are database admins; each also has an RLS-confined app role

**Date:** 2026-09-11
**Status:** Accepted
**Amends:** ADR-019 §3, which said "one Postgres role per person" without distinguishing operating
the database from using the tool

## Context

ADR-019 decided that isolation between people should be enforced by Postgres rather than by a filter
in a client everyone can replace. It specified one role per person, RLS on the person-scoped tables,
and each person configuring their own connection string.

It left one thing unstated, and the owner then made it explicit: **both partners are admins of this
database.** They are co-owners of the business; either must be able to migrate the schema, mint a
role, inspect state and recover from a mistake without waiting for the other.

That requirement collides with the isolation guarantee in a way worth naming rather than papering
over. A Postgres role with `BYPASSRLS` ignores row-level security by definition. Two admins therefore
means **RLS cannot hide one partner's memories from the other** if either chooses to connect as
admin.

The temptation is to not mention it — to say "RLS is enabled, your memories are isolated" and let the
reader assume more than is true. That would be security theatre, and the whole point of writing
decisions down is to stop the next reader inheriting a false belief.

## Decision

Two identities per person, because operating the database and using the tool are different jobs.

| Role | Who gets it | Can do | RLS |
|---|---|---|---|
| `chronicle_admins` | a NOLOGIN group | carries the table privileges | — |
| `chronicle_admin_<id>` | **both partners** | migrate, mint roles, read everything | bypasses |
| `chronicle_app_<id>` | one per person | exactly what Chronicle needs | **confined** |

1. **Chronicle MUST be configured with the `app` connection string**, never the admin one and never
   the `postgres` superuser string. The admin credential is for migrations and inspection, used
   deliberately, by a person.
2. **RLS is `FORCE`d** on `memories`, `insights`, `session_summaries`, `sync_cursor`, `prompt_logs`
   and `users`. Without `FORCE`, the table *owner* also bypasses policies; with it, only roles
   holding `BYPASSRLS` do — which is the two admins, deliberately.
3. A policy keys on `current_setting('chronicle.user_id')`, set as a **role default** on each app
   role, so every connection carries its identity without the client remembering to.
4. Team tables stay shared between app roles. That is not a leak — crossing to another person through
   them is the deliberate act ADR-019 §4 describes.
5. `team_licenses` is admin-only. A licence token is a credential, not team knowledge.
6. Privileges are granted to the **group**, not copied per person, and
   `ALTER DEFAULT PRIVILEGES` covers tables created later — so a future migration cannot silently
   lock the admins out of their own database.
7. The claim MUST be tested from the confined side. `scripts/verify-isolation.mjs` connects **as** an
   app role and asserts the other person's rows are invisible and unwritable — and asserts that an
   admin *does* see both, so the boundary is in the evidence rather than only in this paragraph.

## What the isolation actually buys

Stated precisely, because "we have RLS" invites over-reading:

- The day-to-day tool **cannot** read the other person's memories. Nothing leaks by accident, by a
  bug, or by a recall that forgot its `WHERE`.
- A leaked **app** credential exposes one person's rows, not everyone's.
- A third member added later gets genuine isolation with no schema change — which is the case that
  makes this worth doing at two people.
- It does **not** hide either partner's memories from the other, because both are admins by
  decision. Between the two of them, confidentiality is an agreement, not a mechanism.

## Alternatives Considered

- **One admin (the owner), the other a plain app role.** Rejected by the owner, and rightly: it makes
  one partner dependent on the other to run a migration or recover from a mistake, in a two-person
  partnership where both carry operational responsibility.
- **Both admins, no RLS at all.** Considered seriously, since admins bypass it anyway. Rejected
  because it conflates the two identities: the tool would then run with credentials that can read
  everything, so a bug or a leaked config would expose both people rather than one. The separation is
  the value, not the impossibility of an admin looking.
- **Per-person databases, team tables duplicated.** Rejected: perfect isolation, and it makes the
  shared layer impossible, which is the feature.
- **Keep the `postgres` superuser string on both clients.** Rejected: it is what the code does today,
  and it means the day-to-day tool holds maximum privilege for no reason.

## Consequences

**Positive.** Either partner can operate the database alone. The tool runs with the least privilege it
needs. A third member is a solved problem rather than a schema change. And the guarantee is written
down at the strength it actually holds, which is the only version worth having.

**Negative.** Two credentials per person to manage instead of one, in
`~/.chronicle/cloud-roles.json` — a file that must never reach git and must be handed over a private
channel, not pasted into a chat. Onboarding gains a step.

**RLS is not in force for any client still using the superuser string.** Until both machines are
reconfigured with their app role, the policies exist and protect nothing — and this is the state
immediately after the migration, by design, because rotating a partner's credential without
coordination would take their Chronicle offline without warning.

`BYPASSRLS` on the admin roles means a mistaken `--admin` in a script reads everything. The
protection is that the application never uses that string; there is no technical guard against a
person choosing it.

## Verification

- `scripts/apply-rls.mjs` — idempotent, dry by default, writes credentials to a local file and never
  to stdout.
- `scripts/verify-isolation.mjs` — **12/12** against the live database: an app role sees only its own
  rows, cannot see another's even when asking directly, is refused on insert by the policy
  (`new row violates row-level security policy`), updates and deletes zero of another's rows, still
  reads the shared team tables and the roster, and is denied `team_licenses`. The admin role sees both
  people's rows, asserted on purpose. Evidence: `docs/evidence/isolation-verify.json`.
- The first run of that verification **failed** on the admin role with
  `permission denied for table memories` — `BYPASSRLS` lets a role ignore policies but does not grant
  the privilege to read the table. Fixed by granting to the group. Recorded because it is the kind of
  thing an untested isolation claim hides.
