/**
 * Labelled memory pairs for the de-duplication experiment — 32 pairs, hand-labelled.
 *
 * The question under test is the one `TeamPromotionService` asks before pushing a memory to the
 * team pool: **is this the same knowledge the team already has?** A false positive silently
 * withholds a memory the team never receives; a false negative fills the shared pool with
 * near-copies. The two failures are not symmetric and the report says which each method makes.
 *
 * ## The hard part of the labelling
 *
 * The easy negatives are useless. Two memories about completely different subjects are separated
 * by any method, so a corpus of those measures nothing. Most of the pairs here are **hard
 * negatives**: memories that share most of their vocabulary and are nonetheless different
 * knowledge, because that is where a similarity threshold actually decides something.
 *
 * The `opposite` class is the sharpest of these. "Request bodies are never logged" and "request
 * bodies are logged at debug level" differ by one word and mean contradictory things; a
 * de-duplicator that merges them deletes a policy. Any method that scores them as duplicates is
 * unusable regardless of its aggregate F1, so those pairs are called out separately in the
 * report rather than averaged away.
 */

/** What kind of pair this is, for the per-class breakdown. */
export type PairTag =
  /** The same fact in different words. A duplicate. */
  | 'restatement'
  /** The same decision, one side carrying extra detail. A duplicate. */
  | 'elaboration'
  /** Same topic and much shared vocabulary, different knowledge. NOT a duplicate. */
  | 'related-but-distinct'
  /** Contradictory statements about the same subject. NOT a duplicate, and the costliest error. */
  | 'opposite'
  /** Different subjects entirely. NOT a duplicate. The easy case, kept as a sanity floor. */
  | 'unrelated';

export interface DedupPair {
  id: string;
  a: string;
  b: string;
  /** The label: should a de-duplicator treat these as the same knowledge? */
  duplicate: boolean;
  tags: PairTag[];
  /** Why this label — kept with the label so the judgement is auditable. */
  description: string;
}

export const DEDUP_PAIRS: DedupPair[] = [
  // ── restatement: duplicates in different words ────────────────────────────────────────────
  {
    id: 'dup-money-cents',
    a: 'Monetary amounts are stored as integer cents everywhere, because floating point produced a one-cent discrepancy on an invoice.',
    b: 'We keep all money as whole cents in integers. Floats gave us a rounding error on a total once.',
    duplicate: true,
    tags: ['restatement'],
    description: 'Same decision, same reason, no shared phrasing beyond the domain words.',
  },
  {
    id: 'dup-no-friday',
    a: 'We do not ship on a Friday, because the last two weekend incidents both began with a Friday deploy.',
    b: 'No releases on Fridays. Both of our weekend outages started with a Friday afternoon push.',
    duplicate: true,
    tags: ['restatement'],
    description: 'Identical policy and identical justification.',
  },
  {
    id: 'dup-idempotency',
    a: 'The Stripe charge call carries an Idempotency-Key built from the order id so a retried request cannot bill twice.',
    b: 'We send an idempotency key derived from the order to Stripe, otherwise a network retry double-charges the customer.',
    duplicate: true,
    tags: ['restatement'],
    description: 'Same mechanism, same failure it prevents.',
  },
  {
    id: 'dup-terraform-lock',
    a: 'Terraform state lives in S3 with a DynamoDB lock table after two simultaneous applies corrupted it.',
    b: 'We lock Terraform state through DynamoDB because two people applying at once broke the state file.',
    duplicate: true,
    tags: ['restatement'],
    description: 'Same decision and same incident.',
  },
  {
    id: 'dup-small-prs',
    a: 'Pull requests should stay under four hundred lines; the big ones get approved without being read.',
    b: 'Keep PRs small, roughly 400 lines maximum. Large reviews get a rubber stamp instead of a review.',
    duplicate: true,
    tags: ['restatement'],
    description: 'Same preference, same threshold, same stated reason.',
  },
  {
    id: 'dup-pipe-exit',
    a: 'The exit status after a pipe belongs to the last command, not the pipeline, so a zero from tail hid a failing build.',
    b: 'Reading $? after piping into tail reports tail succeeding. A broken build looked green because of it.',
    duplicate: true,
    tags: ['restatement'],
    description: 'Same lesson about the same shell behaviour.',
  },
  {
    id: 'dup-argon2',
    a: 'Passwords are hashed with Argon2id; bcrypt was dropped at the security review.',
    b: 'We moved password hashing from bcrypt to Argon2id after the security review.',
    duplicate: true,
    tags: ['restatement'],
    description: 'Same migration, same trigger.',
  },

  // ── elaboration: duplicates where one side knows more ─────────────────────────────────────
  {
    id: 'dup-blue-green-detail',
    a: 'Releases are blue-green.',
    b: 'Releases are blue-green with a five minute soak before traffic shifts, and the old colour is kept warm for rollback.',
    duplicate: true,
    tags: ['elaboration'],
    description: 'The second is the first plus detail; the team does not need both rows.',
  },
  {
    id: 'dup-backfill-detail',
    a: 'Backfills run in batches to protect replica lag.',
    b: 'A large backfill goes a thousand rows at a time with a pause between batches, keeping replica lag under one second.',
    duplicate: true,
    tags: ['elaboration'],
    description: 'Same practice at two levels of specificity.',
  },
  {
    id: 'dup-alert-symptom',
    a: 'Alerts fire on user-visible symptoms.',
    b: 'An alert only fires for something a user would notice. The old CPU threshold paged twice a week and everyone closed it unread.',
    duplicate: true,
    tags: ['elaboration'],
    description: 'Same rule, the second adding the incident behind it.',
  },
  {
    id: 'dup-lazy-images',
    a: 'Images below the fold are lazy-loaded.',
    b: 'Product images below the fold load lazily, which improved first contentful paint by forty percent.',
    duplicate: true,
    tags: ['elaboration'],
    description: 'Same technique, the second carrying the measurement.',
  },

  // ── related but distinct: the pairs that decide a threshold ───────────────────────────────
  {
    id: 'nodup-retry-vs-ratelimit',
    a: 'The job queue retries a failed job three times with exponential backoff, then moves it to a dead letter queue.',
    b: 'The public API is rate limited per key with a token bucket, after one integrator retry storm took the service down.',
    duplicate: false,
    tags: ['related-but-distinct'],
    description: 'Both about retries and failure handling; one is consumer-side backoff, the other is server-side admission. Merging them loses the rate limit.',
  },
  {
    id: 'nodup-pool-vs-index',
    a: 'Long-running report queries drained the shared connection pool, so reports got their own pool.',
    b: 'A missing index on orders.customer_id made the dashboard query take eight seconds.',
    duplicate: false,
    tags: ['related-but-distinct'],
    description: 'Both are Postgres performance incidents with different causes and different fixes.',
  },
  {
    id: 'nodup-cache-vs-stale',
    a: 'The product cache is invalidated by event rather than by TTL, because a stale price generated support tickets.',
    b: 'Timestamps are stored in UTC and rendered in the viewer timezone, after a daylight saving bug shifted a report by an hour.',
    duplicate: false,
    tags: ['related-but-distinct'],
    description: 'Both are "stale data reached a user" stories about unrelated subsystems.',
  },
  {
    id: 'nodup-mocks-vs-flake',
    a: 'I avoid mocks and use a fake; a mock-heavy suite stayed green while the integration was broken.',
    b: 'A flaky test froze Date.now but not the database clock, so the two disagreed and it failed one run in ten.',
    duplicate: false,
    tags: ['related-but-distinct'],
    description: 'Both about tests that mislead, but one is a preference and the other a specific defect.',
  },
  {
    id: 'nodup-secrets-vs-staging',
    a: 'Database credentials rotate every thirty days through Secrets Manager and the app re-reads them on a refused connection.',
    b: 'Staging runs on synthetic data and never a production dump; a dump once leaked real addresses into a test send.',
    duplicate: false,
    tags: ['related-but-distinct'],
    description: 'Both are security practices about handling production data. Different controls.',
  },
  {
    id: 'nodup-webhook-vs-idempotency',
    a: 'Stripe webhooks are verified against the signing secret and stored before processing; the event id is the primary key.',
    b: 'The Stripe charge call carries an Idempotency-Key built from the order id so a retried request cannot bill twice.',
    duplicate: false,
    tags: ['related-but-distinct'],
    description: 'Both Stripe, both about not processing twice, but inbound verification and outbound idempotency are separate decisions. The hardest negative in the set.',
  },
  {
    id: 'nodup-tax-vs-currency',
    a: 'Tax is rounded half-up per line item rather than on the total, to match the finance spreadsheet.',
    b: 'Currency codes are validated against ISO 4217 at the API boundary so an unknown currency is rejected early.',
    duplicate: false,
    tags: ['related-but-distinct'],
    description: 'Both money-domain validation rules, unrelated mechanisms.',
  },
  {
    id: 'nodup-focus-vs-plural',
    a: 'The modal keeps focus inside itself and returns it to the opener, after an audit found keyboard users stranded.',
    b: 'Plural forms come from Intl.PluralRules rather than a switch on count, which produced wrong grammar in Polish.',
    duplicate: false,
    tags: ['related-but-distinct'],
    description: 'Both front-end correctness fixes found by review. Nothing else in common.',
  },
  {
    id: 'nodup-flags-vs-runbook',
    a: 'A feature flag is deleted within two sprints of rollout; three forgotten flags interacted during an incident.',
    b: 'Every alert links to its runbook section, and an alert without one may not page a human.',
    duplicate: false,
    tags: ['related-but-distinct'],
    description: 'Both process rules with an incident behind them; different processes.',
  },
  {
    id: 'nodup-queue-order-vs-retry',
    a: 'The queue gives no ordering guarantee, so consumers are idempotent and reconcile by version.',
    b: 'The job queue retries a failed job three times with exponential backoff before the dead letter queue.',
    duplicate: false,
    tags: ['related-but-distinct'],
    description: 'Same queue, heavy vocabulary overlap, two different properties of it.',
  },
  {
    id: 'nodup-csv-vs-pdf',
    a: 'The CSV export streams rows instead of building an array; a large tenant exhausted the pod memory.',
    b: 'Invoice PDF rendering moved to a background worker after it pushed request p95 past two seconds.',
    duplicate: false,
    tags: ['related-but-distinct'],
    description: 'Two export/rendering performance fixes with different mechanisms.',
  },

  // ── opposite: the pairs a de-duplicator must never merge ──────────────────────────────────
  {
    id: 'opp-log-bodies',
    a: 'Request bodies are never written to the logs.',
    b: 'Request bodies are written to the logs at debug level.',
    duplicate: false,
    tags: ['opposite'],
    description: 'One word apart and contradictory. Merging them deletes a privacy policy.',
  },
  {
    id: 'opp-friday',
    a: 'We do not ship on a Friday.',
    b: 'We do ship on a Friday, as long as somebody is on call for the weekend.',
    duplicate: false,
    tags: ['opposite'],
    description: 'A superseded policy and its replacement must both be visible.',
  },
  {
    id: 'opp-mocks',
    a: 'I avoid mocks in tests and prefer a fake.',
    b: 'I prefer mocks in tests and avoid hand-written fakes.',
    duplicate: false,
    tags: ['opposite'],
    description: 'Opposite preferences in near-identical vocabulary.',
  },
  {
    id: 'opp-staging-dump',
    a: 'Staging never runs on a production dump.',
    b: 'Staging is refreshed from a production dump every Monday.',
    duplicate: false,
    tags: ['opposite'],
    description: 'Contradictory practices about the same environment.',
  },
  {
    id: 'opp-float-money',
    a: 'Monetary amounts are stored as integer cents, never as floats.',
    b: 'Monetary amounts are stored as floating point doubles for convenience.',
    duplicate: false,
    tags: ['opposite'],
    description: 'The decision and the thing it rejected.',
  },

  // ── unrelated: the sanity floor ───────────────────────────────────────────────────────────
  {
    id: 'nodup-nat-vs-i18n',
    a: 'The NAT gateway was the largest line on the AWS bill; VPC endpoints removed most of it.',
    b: 'Plural forms come from Intl.PluralRules instead of a hand-written switch on count.',
    duplicate: false,
    tags: ['unrelated'],
    description: 'No shared subject or vocabulary.',
  },
  {
    id: 'nodup-bounce-vs-terraform',
    a: 'A hard bounce unsubscribes the address automatically to protect sending reputation.',
    b: 'Terraform state lives in S3 with a DynamoDB lock table.',
    duplicate: false,
    tags: ['unrelated'],
    description: 'Unrelated subsystems.',
  },
  {
    id: 'nodup-css-vs-refund',
    a: 'Styling is CSS modules rather than a runtime styled-components setup.',
    b: 'A refund can be issued for ninety days, after which it needs a support override.',
    duplicate: false,
    tags: ['unrelated'],
    description: 'Unrelated domains.',
  },
  {
    id: 'nodup-onboarding-vs-grpc',
    a: 'A new engineer ships a one line change on their first day to exercise the pipeline.',
    b: 'The gRPC client uses a two second deadline and a single retry.',
    duplicate: false,
    tags: ['unrelated'],
    description: 'Unrelated practice and configuration.',
  },
  {
    id: 'nodup-url-state-vs-tax',
    a: 'Filter state lives in the URL query string so a view can be shared as a link.',
    b: 'Tax is rounded half-up per line item rather than on the invoice total.',
    duplicate: false,
    tags: ['unrelated'],
    description: 'Unrelated domains.',
  },
];

/** How many pairs are labelled duplicates — the positive class size. */
export const POSITIVES = DEDUP_PAIRS.filter((p) => p.duplicate).length;
