/**
 * The polarity corpus — can a guard tell a reversed decision from a restated one?
 *
 * ## Why this corpus exists separately
 *
 * `pairs.ts` carries five `opposite` pairs, and five is not enough to choose between candidate
 * contradiction guards. The shipped guard (`negationMismatch`) catches four of them with a rule
 * that has **no free parameters**; a scoped variant catches four with **two** fitted ones, and on
 * five samples those two results are indistinguishable. A guard selected on that evidence is
 * selected on noise.
 *
 * The five pairs also cannot measure what the guard *costs*. The guard is strictly
 * safety-improving — it can only turn a merge into a non-merge — so its errors are false
 * *blocks*, and a corpus made only of contradictions contains none of those by construction.
 * Both sides have to sit in one corpus or the trade cannot be seen at all.
 *
 * ## The recipe
 *
 * For every memory in `../lib/fixture.ts` that states a standing decision, two texts:
 *
 * - **`reversed`** — the same subject with the opposite standing decision, plus a reason for the
 *   reversal. A de-duplicator MUST NOT merge this with the fixture memory: merging withholds a
 *   memory that reverses a policy, which is the error nobody observes.
 * - **`restated`** — the same standing decision in different words, keeping the original's
 *   rationale. A de-duplicator SHOULD merge this, and a guard that blocks it costs a duplicate
 *   left in the pool, which somebody can see and delete.
 *
 * The two differ in exactly one respect: same subject, same vocabulary, comparable length, same
 * shape — only the polarity of the decision changes. That is what makes the corpus measure the
 * guard rather than the similarity method underneath it.
 *
 * Three fixture memories are **excluded** — `m-index-missing`, `m-test-flake-clock` and
 * `m-cost-nat-gateway`. Each reports one past incident and asserts no standing decision, so
 * reversing it describes a different event rather than contradicting anything. They are listed
 * in `EXCLUDED` with a reason rather than silently omitted, and the soundness check in `run.ts`
 * fails when the eligible set plus the exclusions does not account for every fixture memory — so
 * a memory added later cannot be quietly dropped.
 *
 * ## Provenance, and the honest limit
 *
 * Writing both classes by hand is a judgement, not a mechanical transform, so this file could in
 * principle have been written to favour one guard. Two things constrain that, both checkable by
 * a reader:
 *
 * 1. It is committed **before** any change to `src/services/contradiction.ts`, in its own commit.
 *    `git log --oneline -- experiments/dedup/polarity.ts src/services/contradiction.ts` shows the
 *    order.
 * 2. The runner reports how negating tokens are distributed across the two classes. If they
 *    cluster in `reversed`, then "contains a negation" is itself the label and the corpus
 *    measures nothing — so the distribution is printed with the results rather than assumed
 *    benign.
 */

/** One fixture memory, with its decision reversed and restated. */
export interface PolarityCase {
  /** The fixture memory id both texts are written against. */
  of: string;
  /** Opposite standing decision, same subject. A guard must flag this. */
  reversed: string;
  /** Same standing decision, different words. A guard must not flag this. */
  restated: string;
}

/** Fixture memories with no standing decision to reverse, and why each is out. */
export const EXCLUDED: Record<string, string> = {
  'm-index-missing': 'Reports one missing index and its fix; asserts no standing decision.',
  'm-test-flake-clock': 'Diagnoses one flaky test; reversing it describes a different test.',
  'm-cost-nat-gateway': 'An observation about a past bill and the change that removed it.',
};

export const POLARITY: PolarityCase[] = [
  {
    of: 'm-stripe-idempotency',
    reversed:
      'Calls to the Stripe charge endpoint no longer send an Idempotency-Key. The gateway de-duplicates on the order reference itself, so carrying our own key was redundant.',
    restated:
      'Every Stripe charge request carries an idempotency key derived from the order id, so a network timeout followed by a retry cannot bill the customer twice.',
  },
  {
    of: 'm-webhook-replay',
    reversed:
      'Stripe webhooks are processed straight from the request without checking the signing secret or recording the event first, so a replayed delivery is handled again from scratch.',
    restated:
      'Incoming Stripe webhooks have their signature checked and the event persisted before any handler runs; running a handler twice is harmless because the event id is the primary key.',
  },
  {
    of: 'm-money-integers',
    reversed:
      'Monetary amounts are stored as floating point doubles everywhere. Integer cents were rejected because the conversions at every boundary were more trouble than the rounding.',
    restated:
      'Money is held as whole cents in an integer column everywhere, never as a float; a one-cent gap between an invoice total and the sum of its lines is what settled it.',
  },
  {
    of: 'm-tax-rounding',
    reversed:
      'Tax is rounded half-up once on the invoice total rather than on each line item, so the figures agree with the accountant spreadsheet that the finance team reconciles against.',
    restated:
      'Each line item has its tax rounded half-up individually instead of rounding the total once, which is what makes our figures match the spreadsheet finance reconciles against.',
  },
  {
    of: 'm-refund-window',
    reversed:
      'A refund can be issued at any time after the charge, with no ninety day limit and no support override involved.',
    restated:
      'Refunds stay available for ninety days from the charge; after that nobody can issue one without a support override, and the override is logged against the agent id.',
  },
  {
    of: 'm-invoice-pdf-slow',
    reversed:
      'Invoice PDFs are rendered inline in the request rather than on a background worker, because the extra job id round trip confused more clients than the two second p95 ever did.',
    restated:
      'PDF invoice rendering was moved off the request path onto a background worker when it pushed p95 past two seconds; the endpoint hands back a job id and the client polls it.',
  },
  {
    of: 'm-db-pool-exhaustion',
    reversed:
      'Report queries share the one connection pool with ordinary requests. A second pool was considered and not adopted, because splitting the ceiling left neither half big enough under load.',
    restated:
      'Reports were moved onto their own connection pool with a lower ceiling after long-running report queries drained the shared one and starved normal requests.',
  },
  {
    of: 'm-currency-iso',
    reversed:
      'Currency codes are not validated at the API boundary; whatever the caller sends is stored and the ledger deals with it afterwards.',
    restated:
      'An unknown currency is rejected at the API boundary by checking the code against ISO 4217, so it never reaches the ledger at all.',
  },
  {
    of: 'm-csv-export-memory',
    reversed:
      'The CSV export collects every row into an array before writing the response, which keeps the handler simple enough to read in one sitting.',
    restated:
      'CSV export writes rows to the response as it reads them instead of buffering the whole set, after a large tenant exhausted the pod memory and the download was killed half way.',
  },
  {
    of: 'm-rate-limit',
    reversed:
      'The public API is not rate limited. Per-key token buckets were tried and dropped because they fired on legitimate burst traffic from the largest integrators.',
    restated:
      'Every key on the public API gets a token bucket limit, added after one integrator retry storm took the service down for every other customer.',
  },
  {
    of: 'm-retry-queue',
    reversed:
      'A failed job is retried indefinitely with exponential backoff and never moves to a dead letter queue, so no work is quietly abandoned.',
    restated:
      'The queue gives a failed job three attempts with exponential backoff between them and then parks it in a dead letter queue for a human to inspect.',
  },
  {
    of: 'm-queue-ordering',
    reversed:
      'The queue delivers messages in strict order, so a consumer can assume a later message was produced later and does not need to reconcile by version.',
    restated:
      'Message order is not guaranteed by the queue; consumers are written to be idempotent and reconcile on a version number because two attempts can land out of order.',
  },
  {
    of: 'm-timeout-grpc',
    reversed:
      'The gRPC client runs with no deadline and retries until it succeeds, since a two second deadline turned a slow upstream into a user-visible error.',
    restated:
      'The gRPC client sets a two second deadline and retries once. Leaving the default of no deadline in place had starved the thread pool while an upstream was slow.',
  },
  {
    of: 'm-cache-invalidation',
    reversed:
      'The product cache expires on a time to live rather than on an event, because the event fan-out was invalidating far more keys than it needed to.',
    restated:
      'Product cache entries are dropped when an event says the product changed, never on a timer, after a stale price generated support tickets twice.',
  },
  {
    of: 'm-search-typos',
    reversed:
      'Product search matches exactly and does not tolerate a misspelled name; trigram similarity was removed after it ranked unrelated items above the right one.',
    restated:
      'A shopper who types a product name wrong still finds the item, because search falls back to trigram similarity in Postgres.',
  },
  {
    of: 'm-email-bounce',
    reversed:
      'A hard bounce does not unsubscribe the address; the send is retried on the next campaign in case the mailbox was only temporarily unavailable.',
    restated:
      'An address that hard bounces is unsubscribed automatically, because repeated delivery to dead mailboxes was damaging the sending reputation of the whole domain.',
  },
  {
    of: 'm-migration-backfill',
    reversed:
      'A large backfill runs as one statement over the whole table, because batching it held a transaction open far longer in total and the replica never caught up anyway.',
    restated:
      'Backfills go a thousand rows at a time with a pause in between, which keeps replica lag under one second while they run.',
  },
  {
    of: 'm-locale-dates',
    reversed:
      'Timestamps are stored in the viewer local timezone rather than UTC, so a report never needs converting before somebody reads it.',
    restated:
      'Every timestamp is persisted as UTC and converted to the reader timezone at render time, after a daylight saving bug moved every row of the monthly report by an hour.',
  },
  {
    of: 'm-password-hash',
    reversed:
      'Passwords are hashed with bcrypt. Argon2id was evaluated at the security review and not adopted, because the memory cost per login was more than the instances could carry.',
    restated:
      'Password hashing is Argon2id, which replaced bcrypt at the security review once it was clear the bcrypt work factor could not be pushed high enough on this hardware.',
  },
  {
    of: 'm-filter-state-url',
    reversed:
      'Filter state is kept in component state and not in the URL, because the query string grew unreadable and people were sharing links that no longer parsed.',
    restated:
      'Filters are encoded in the URL query string instead of component state, so somebody can paste a filtered view into a chat and have it open the same way for them.',
  },
  {
    of: 'm-form-autosave',
    reversed:
      'The long application form does not autosave. Drafts in local storage were removed after a stale draft overwrote what somebody had just typed on another device.',
    restated:
      'The long form drops a draft into local storage every ten seconds, because people were losing twenty minutes of typing whenever a session expired.',
  },
  {
    of: 'm-image-lazy',
    reversed:
      'Catalogue images are all loaded eagerly rather than lazily, since the placeholder shift was worse for the page than the extra bytes ever were.',
    restated:
      'Images below the fold on the catalogue page load lazily, which took forty percent off first contentful paint.',
  },
  {
    of: 'm-a11y-focus-trap',
    reversed:
      'The modal does not trap focus, and focus is left wherever it happened to be when the modal closes.',
    restated:
      'A modal holds focus within itself while it is open and returns it to the trigger element on close, after an audit found keyboard users with no way out of it.',
  },
  {
    of: 'm-i18n-plural',
    reversed:
      'Plural forms come from a hand written switch on the count rather than Intl.PluralRules, because the platform rules disagreed with what our translators had signed off.',
    restated:
      'Pluralisation goes through Intl.PluralRules instead of a switch statement on count, which had been producing wrong grammar in Polish and Russian.',
  },
  {
    of: 'm-css-modules',
    reversed:
      'Styling is a runtime styled-components setup rather than CSS modules; the build-time approach could not express the themeable parts without duplicating every rule.',
    restated:
      'We use CSS modules and not a runtime styled-components setup, because style recalculation was showing up as a real cost in the profiler.',
  },
  {
    of: 'm-feature-flags',
    reversed:
      'Feature flags are left in place indefinitely after a rollout, so a path can always be switched back without waiting for a deploy.',
    restated:
      'A flag is removed within two sprints of being fully rolled out, after three forgotten flags interacted during an incident and nobody could tell which path production was taking.',
  },
  {
    of: 'm-terraform-state-lock',
    reversed:
      'Terraform state is a local file with no lock table, because the DynamoDB lock kept a stale lease after a cancelled apply and blocked everybody else.',
    restated:
      'Terraform keeps its state in S3 and locks through a DynamoDB table, which exists because two simultaneous applies had already corrupted the state once.',
  },
  {
    of: 'm-secrets-rotation',
    reversed:
      'Database credentials do not rotate. One value is read at startup and cached for the life of the process, since a rotation mid-request took the service down.',
    restated:
      'Secrets Manager rotates the database credentials every thirty days, and the application re-reads them whenever a connection is refused rather than holding one value forever.',
  },
  {
    of: 'm-blue-green',
    reversed:
      'A release replaces the running version in place, with no second colour and no soak period, because keeping the old colour warm doubled the cost of the fleet.',
    restated:
      'A release brings up a second colour, soaks it for five minutes before shifting traffic across, and leaves the old colour running so a rollback is immediate.',
  },
  {
    of: 'm-log-pii',
    reversed:
      'Request bodies are written to the logs at debug level, which is how the payments team reconstructs a charge that failed.',
    restated:
      'Nothing from a request body ever reaches the logs, after a support ticket turned out to include a CloudWatch screenshot with a shopper card metadata in clear text.',
  },
  {
    of: 'm-alert-fatigue',
    reversed:
      'Alerts fire on resource thresholds such as CPU as well as on user-visible symptoms, because waiting for a symptom means the user noticed before we did.',
    restated:
      'An alert is only allowed to fire for something a user would actually feel, never for CPU by itself; the old CPU threshold paged twice a week and everyone had stopped reading it.',
  },
  {
    of: 'm-oncall-runbook',
    reversed:
      'An alert may page a human without a runbook link. Requiring one meant real alerts sat unrouted while somebody wrote the documentation for them.',
    restated:
      'Every alert points at the runbook section covering it, and an alert with no runbook is not permitted to page anybody.',
  },
  {
    of: 'm-staging-data',
    reversed:
      'Staging is refreshed from a production dump every Monday, because synthetic data never reproduced the data shapes that actually break things.',
    restated:
      'Staging never sees a production dump and runs on synthetic data only, after a dump put real addresses into a test notification batch that went out for real.',
  },
  {
    of: 'm-k8s-requests',
    reversed:
      'Pods are deployed without CPU and memory requests, because the declared numbers were guesses and left most of each node sitting idle.',
    restated:
      'Every pod sets CPU and memory requests; without them the scheduler had packed nodes until the kubelet began evicting under pressure.',
  },
  {
    of: 'm-pref-small-prs',
    reversed:
      'I would rather review one large pull request than a chain of small ones, because the small ones hide the shape of the change and each still needs its own context.',
    restated:
      'I want pull requests to stay under roughly four hundred lines; the big ones come back approved within a minute and no comments, which tells me nobody read them.',
  },
  {
    of: 'm-pref-conventional-commits',
    reversed:
      'Commit subjects are free form and the body restates what the diff changed, since a reader usually wants the summary rather than the reasoning behind it.',
    restated:
      'Commits follow Conventional Commits, and the body explains why the change was made rather than repeating what the diff already shows.',
  },
  {
    of: 'm-pref-no-mocks',
    reversed:
      'I reach for a mock rather than writing a fake, because a hand-written fake drifts from the real thing and nobody notices until production.',
    restated:
      'I stay away from mocks and write a fake instead; a suite that mocked everything sat green for weeks while the real integration was broken.',
  },
  {
    of: 'm-pref-tdd-bugfix',
    reversed:
      'For a defect I write the fix first and add a test afterwards, if the fix turns out to have been subtle enough to deserve one.',
    restated:
      'A bug gets its failing test before its fix, every time. Without a red test ahead of it the fix is only a guess at what was actually wrong.',
  },
  {
    of: 'm-pref-language-split',
    reversed:
      'I think through design in English and write the code, the commits and the documents in Spanish.',
    restated:
      'Design thinking happens in Spanish for me; the code, the commit messages and the documents are all written in English.',
  },
  {
    of: 'm-pref-no-release-friday',
    reversed:
      'We do ship on a Friday, as long as somebody has agreed to be on call through the weekend.',
    restated:
      'Friday deploys are off the table here. The last two incidents that bled into a weekend both began with a Friday afternoon release.',
  },
  {
    of: 'm-lesson-pipe-exit',
    reversed:
      'The exit status after a pipe is the status of the pipeline as a whole, so a failure anywhere along it surfaces as a non-zero result.',
    restated:
      'After a pipe, the exit status you read belongs to the last command and not to the pipeline; a zero coming out of tail concealed a build that had actually failed.',
  },
  {
    of: 'm-lesson-create-if-not-exists',
    reversed:
      'CREATE TABLE IF NOT EXISTS reconciles an existing database against the schema file, so adding a column there is enough to migrate a store that already exists.',
    restated:
      'On a database that already exists, CREATE TABLE IF NOT EXISTS does nothing at all, which means a new column in the schema file never arrives and is not a migration.',
  },
  {
    of: 'm-lesson-green-gate',
    reversed:
      'A gate that passes is verified by passing. Making it fail on purpose tells you nothing the green run had not already established.',
    restated:
      'Until a gate has failed on purpose at least once it is not verified, and its green tick is only evidence that it executed.',
  },
  {
    of: 'm-lesson-one-sample',
    reversed:
      'A single reading is a measurement, and a median of five is reliable enough to report even while the series is still warming up.',
    restated:
      'One reading is not a measurement, and neither is a median of five taken during a warm-up. Report the spread or report nothing at all.',
  },
  {
    of: 'm-lesson-cast-not-conversion',
    reversed:
      'A TypeScript cast converts the value at runtime, so a driver handing back a Date where the code declares a string is reconciled before the bind happens.',
    restated:
      'A cast in TypeScript asserts a type, it does not convert one. The driver returned a Date where the code claimed a string, and the bind failed only against the real engine.',
  },
  {
    of: 'm-lesson-adr-why',
    reversed:
      'A decision record should state what changed. The reasoning is already implicit in the diff, and spelling it out is what makes records go stale.',
    restated:
      'A decision record exists to say why. What changed is already visible in the diff, and restating it only adds maintenance cost with no value for the reader.',
  },
  {
    of: 'm-coord-gabo-leaders',
    reversed:
      'I have the leaders surface this sprint and Gabriel is keeping out of that directory, so we are not resolving the same conflict twice.',
    restated:
      'The leaders surface belongs to Gabriel for this sprint; I stay out of that directory so the two of us are not resolving one conflict twice.',
  },
  {
    of: 'm-coord-onboarding',
    reversed:
      'A new engineer does not ship anything in their first week, so the pipeline is exercised by somebody who already knows what a failure in it looks like.',
    restated:
      'On day one a new engineer puts a one line change all the way to production, so the whole path from clone to deploy gets exercised while somebody is watching.',
  },
];
