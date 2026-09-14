---
id: ADR-023
type: adr
status: active
tier: T1
properties: [defended, verifiable, auditable]
obligations: 4
depends_on: [ADR-019, ADR-020]
---

# ADR-023: The app-role confinement is a default, not a boundary — and the docs said otherwise

**Date:** 2026-09-14
**Status:** Accepted
**Corrects:** ADR-019 §3 and ADR-020's characterisation of `chronicle_app_*` as "RLS-confined".
Also corrects `docs/evidence/isolation-verify.json`, which recorded 12/12 for a property it did
not test.

## Context

ADR-019 §3 introduced row-level security so that each person's memories, insights, session
summaries and prompt logs are reachable only by that person, with both partners as admins by
ADR-020. `scripts/verify-isolation.mjs` verified it from the confined side and reported **12/12**,
including that one app role cannot read, update, delete or forge rows belonging to the other.

Every one of those checks is still true, and all of them share an assumption nobody stated: that the
session behaves. The policy is

```sql
USING      (user_id = current_setting('chronicle.user_id', true))
WITH CHECK (user_id = current_setting('chronicle.user_id', true))
```

and the value is established with `ALTER ROLE chronicle_app_<id> SET chronicle.user_id = '<id>'`.

**`ALTER ROLE … SET` establishes a default, not a constraint.** A custom GUC in an unreserved
namespace carries no privilege of its own, so any session may re-point it. Tested against the real
mirror, as a new check in the isolation script:

```
FAIL  an app role CANNOT re-point chronicle.user_id at another person — IT CAN.
```

So the row filter follows **whatever the client claims to be**. An app credential is confined by its
own good manners. Whoever holds one can `SET chronicle.user_id` to the other person's id and read and
write their rows — the reads, the forged inserts and the updates that the 12 passing checks proved
were blocked all succeed once the variable is moved.

The checks were not wrong; they were incomplete in a way that is worth naming, because it is a
general shape. They all tested *the mechanism operating as designed*, and none tested *the mechanism
being disregarded*. A security control that has only been tested by a cooperating client has not been
tested. That the suite reported `12/12` made it worse: a confident number attached to a property that
had not been examined is more misleading than no number.

This does not change what an **admin** can do. Both partners are admins with `BYPASSRLS` by ADR-020,
deliberately, and the isolation script has always asserted that boundary explicitly. What changes is
that the *app* roles were presented as a meaningful step down from admin, and they are not.

## Decision

1. **Say what is true now.** Until the policy changes, an app connection string is equivalent to full
   read/write access to every person's rows in the person tables. ADR-019 §3's "confined" is
   downgraded to "scoped by default", and `docs/dependency-policy.md` is not involved — this is a
   data-access claim, and it is corrected in the spec's security section and in the two ADRs' index
   entries rather than by editing accepted ADRs.
2. **A credential is classified by what it can reach, not by its name.** `chronicle_app_*` is to be
   treated exactly as `chronicle_admin_*` is treated for the purpose of deciding where it may be
   stored or who may hold it. In particular it is **not** suitable for a CI secret, a shared runner,
   or any third party, because handing it over hands over both partners' data.
3. **The isolation script keeps the failing check.** It is the only thing standing between this
   finding and a future reader believing the older 12/12. A red check that describes reality is worth
   more than a green suite that does not.
4. **The fix, when applied, binds rows to the role rather than to a claim.** The policy becomes

   ```sql
   USING (user_id = substring(current_user from '^chronicle_app_(.*)$'))
   ```

   `current_user` cannot be changed without credentials for the other role, since `SET ROLE` requires
   membership, so the filter stops being client-asserted. This is deliberately *not* applied in the
   same change that discovered the problem: it alters access control on a database a partner is
   actively using, and applying it while he is configured with a superuser string (ADR-019's open
   item) would change nothing for him while risking breaking the working path.

## Alternatives Considered

- **Keep the GUC and forbid `SET`.** There is no clean way to do it. `GRANT SET ON PARAMETER`
  (PostgreSQL 15+) governs parameters that already require privilege; a custom `chronicle.*` GUC is
  settable by anyone by design. Making it privileged would mean shipping an extension, which is a
  large amount of machinery to defend a design that has a simpler alternative.
- **Set the GUC from the application on every connection and trust that.** This is what happens today
  and it is precisely the problem: the application setting it correctly is not a control, because the
  control has to hold against a client that does not.
- **Give each person their own database.** Genuine isolation, and it discards the shared team tables
  that are the reason the mirror exists (ADR-019 §4). Rejected for the same reason as before.
- **Apply the `current_user` policy immediately, in this change.** Rejected on sequencing, not on
  merit — see Decision 4. It is the intended next step, not a maybe.
- **Quietly fix it and not write this down.** The failure mode being corrected is a verification that
  reported a number for something it had not checked. Repeating that by silently editing the
  mechanism would leave the same misleading evidence file in place.

## Consequences

**Positive.** The security posture is now described accurately, which is the precondition for anyone
deciding what to do about it. The isolation suite tests the uncooperative case, which is the only case
a control needs to survive. And the rule in Decision 2 is simple enough to apply without re-reading
this: any Chronicle database credential is a full-access credential until the policy changes.

**Negative.** `verify-isolation.mjs` now exits non-zero, so it cannot be used as a pass/fail gate
until either the policy is fixed or the check is deliberately marked expected-failing. Leaving it red
is the honest state and it is also friction; the friction is the point, and it should be resolved by
fixing the policy rather than by softening the check.

The `cloud-verify` CI job is affected by the decision, not by the code: it has no credential
configured, and per Decision 2 the only credential that would make it work is one that should not be
placed in a repository secret. That job stays skipped until the policy is fixed, which is a better
outcome than a green job that required handing a partner's data to a CI runner.

## Verification

- `scripts/verify-isolation.mjs` — 13 checks, **12 pass and 1 fails**, against the real mirror. The
  failing one is `an app role CANNOT re-point chronicle.user_id at another person`, and its detail
  line states the consequence rather than just the assertion. The probe sets the variable to a value
  matching no user and reads it back; no person's rows are read, counted or written to establish it.
- `docs/evidence/isolation-verify.json` — re-recorded at 12/13. The previous 12/12 record is
  superseded and should not be quoted.
- **Not verified:** that the `current_user` policy in Decision 4 behaves as expected. It has not been
  applied, and an untested replacement is exactly the kind of claim this ADR exists to stop. When it
  is applied, this same check must flip to green *and* the other twelve must stay green, or the fix
  has traded one problem for another.
