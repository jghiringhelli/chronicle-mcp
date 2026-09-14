---
id: ADR-024
type: adr
status: active
tier: T1
properties: [defended, verifiable]
obligations: 3
depends_on: [ADR-023]
---

# ADR-024: Bind rows to a role through a lookup table, not through the role's name

**Date:** 2026-09-14
**Status:** Accepted
**Amends:** ADR-023 Decision 4 — the SQL, not the decision. Binding the row filter to `current_user`
instead of to a client-settable variable stands unchanged.

## Context

ADR-023 established that the app-role confinement was a default rather than a boundary, and named
the fix:

```sql
USING (user_id = substring(current_user from '^chronicle_app_(.*)$'))
```

Implementing it surfaced a defect in that specific SQL. Role names are not user ids — they are
derived from them:

```js
const roleName = (prefix, userId) => `${prefix}_${userId.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;
```

The sanitisation is necessary, because a chronicle user id is whatever a person's git identity gives
and Postgres will not accept `@` or `.` in an unquoted role name. But it is **not reversible**.
`jcghiri@gmail.com` becomes `chronicle_app_jcghiri_gmail_com`, and the substring returns
`jcghiri_gmail_com`, which matches no row. Today's two ids — `gabo` and `jghiringhelli` — happen to
survive the transformation unchanged, which is precisely what would have made this ship: it works
for exactly the data present when it is written.

The failure mode is quiet. The policy would match nothing, so the person would simply see an empty
store — no error, no denial, just a Chronicle that appears to have forgotten everything. And the
sanitisation is many-to-one, so two ids differing only in punctuation would map to the same role
name and therefore to each other's rows.

There is a second requirement the substring cannot express. ADR-023's Decision 2 means CI needs its
own principal, and a service account's id is chosen rather than derived — `chronicle_app_ci` owning
rows under `ci` is a mapping, not a transformation.

## Decision

1. **A table, `chronicle_role_map (role_name PRIMARY KEY, user_id)`**, populated when each role is
   provisioned. The policy becomes:

   ```sql
   USING (user_id = (SELECT m.user_id FROM chronicle_role_map m WHERE m.role_name = current_user))
   ```

   `current_user` is still the anchor, so ADR-023's property holds: `SET ROLE` requires membership,
   and there is no longer any session state a client can set to claim a different identity.
2. **App roles get `SELECT` on the map and nothing else.** The subquery runs as the querying role, so
   it must be readable. Role names are not secret — passwords are — and the map is explicitly not
   under RLS, because a policy that needs the map to evaluate itself would not terminate.
3. **The vestigial `ALTER ROLE … SET chronicle.user_id` default is cleared**, with `RESET`. Leaving
   it would leave something that looks like it governs access and does not.

## Alternatives Considered

- **Keep the substring and forbid ids that need sanitising.** Rejected: the id comes from a person's
  git configuration, so the constraint would be enforced on the wrong side of the system, and the
  failure would land on whoever's email contains a dot — which is all of them.
- **Store the user id as a role comment or a `pg_shdescription` entry.** Works, and hides an
  access-control input somewhere no one would look for it.
- **A `SECURITY DEFINER` function returning the current role's user id.** Equivalent in effect and
  adds a function to audit. The table is the data, and a function around it would be indirection over
  the same row.
- **Give every role a matching id by making ids Postgres-safe everywhere.** That is a change to
  identity derivation (`src/shared/repo-identity.ts`, ADR-018) to suit a database naming rule. Wrong
  direction.

## Consequences

**Positive.** Correct for any id, including ones not yet seen, and service accounts become ordinary
rather than special. The mapping is a row someone can read, which makes "who can this credential act
as" a query rather than an inference from a regex.

**Negative.** One more object to keep in step: a role that exists without a map row can read nothing,
which is fail-closed and still confusing to debug. `verify-isolation.mjs` is the check that would
catch it, since a person with no rows visible fails its first assertion.

The policy now runs a subquery per evaluation. It is an InitPlan on a single-row primary-key lookup
against a table of three rows, and `recall` is already measured well inside NFR-03 (p95 14–23ms at
10k), so this is noted rather than measured — if the cloud path ever becomes latency-relevant, it is
the first thing to re-measure rather than assume.

## Verification

- **Not yet applied.** `scripts/apply-rls.mjs --apply` needs Railway's own connection string:
  creating the table requires CREATE on schema `public`, which PostgreSQL 15+ does not grant, and
  which `chronicle_admin_*` does not have. The attempt failed at exactly that point with
  `permission denied for schema public`, before any policy was touched, so the mirror is unchanged
  and still in the state ADR-023 describes.
- The script now also grants `CREATE ON SCHEMA public` to `chronicle_admins`, so this is the last run
  that needs Railway's credential.
- **The acceptance test is already written and currently red**: `scripts/verify-isolation.mjs` check
  `an app role CANNOT re-point chronicle.user_id at another person`. Applying this must turn it green
  **and leave the other twelve green** — a fix that confines by breaking access is not a fix.
