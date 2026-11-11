/**
 * The memory fixture — 51 hand-written memories that stand in for a developer's store.
 *
 * Three design rules, each of which exists because breaking it would make the experiment
 * flatter itself:
 *
 * 1. **Distractors share vocabulary with the queries.** Eight memories mention `retry`, five
 *    mention `queue`, four mention `performance`. A corpus where every query has exactly one
 *    lexical match scores 1.00 on every configuration and measures nothing. The distractors
 *    are the measurement.
 * 2. **Weights are deliberately adversarial.** The current recall path orders by `weight DESC`
 *    and ignores the query, so some exact-match targets are given a LOW weight and some
 *    irrelevant distractors a HIGH one. Without that, weight-ordering would look like ranking.
 * 3. **The content is not about Chronicle.** A self-referential corpus would let me write
 *    memories in the vocabulary of the queries without noticing. This is a plausible store for
 *    somebody working on a billing product, a web app and its infrastructure.
 *
 * The memories were written, and the queries in `../recall/corpus.ts` labelled against them,
 * **before any embedding code existed** — committed in that order on purpose, so the git
 * history is the evidence that the corpus was not tuned to the ranker. See
 * `../README.md` § Provenance.
 */

import type { MemoryType, MemoryScope } from '../../src/domain/types.js';

/** One fixture memory. `id` is stable and is what the labelled queries refer to. */
export interface FixtureMemory {
  id: string;
  content: string;
  memoryType: MemoryType;
  scope: MemoryScope;
  project?: string;
  category?: string;
  tags: string[];
  /**
   * Weight to force after creation, in [0, 1].
   *
   * Set explicitly rather than left to the tier defaults, because the weight-ordering defect
   * is one of the things under measurement and it only shows up when weight and relevance
   * disagree.
   */
  weight: number;
  confirmed?: boolean;
}

export const BILLING = 'github.com/acme/billing-api';
export const WEBAPP = 'github.com/acme/web-app';
export const INFRA = 'github.com/acme/infra';

export const FIXTURE: FixtureMemory[] = [
  // ── billing-api ────────────────────────────────────────────────────────────────────────
  {
    id: 'm-stripe-idempotency',
    content:
      'Every call to the Stripe charge endpoint sends an Idempotency-Key derived from the order id, because a retry after a network timeout would otherwise bill the same customer a second time.',
    memoryType: 'architectural', scope: 'project', project: BILLING,
    category: 'payments', tags: ['stripe', 'payments', 'retry'], weight: 0.41,
  },
  {
    id: 'm-webhook-replay',
    content:
      'Stripe webhooks are verified against the signing secret and written to the events table before anything processes them. The handler is safe to run twice because the event id is the primary key.',
    memoryType: 'architectural', scope: 'project', project: BILLING,
    category: 'payments', tags: ['stripe', 'webhooks'], weight: 0.58,
  },
  {
    id: 'm-money-integers',
    content:
      'Monetary amounts are stored as integer cents everywhere. Floating point was rejected after a one-cent discrepancy appeared between an invoice total and the sum of its lines.',
    memoryType: 'architectural', scope: 'project', project: BILLING,
    category: 'money', tags: ['money', 'precision'], weight: 0.62, confirmed: true,
  },
  {
    id: 'm-tax-rounding',
    content:
      'Tax is rounded half-up on each line item rather than once on the total, so the figures agree with the accountant spreadsheet that the finance team reconciles against.',
    memoryType: 'procedural', scope: 'project', project: BILLING,
    category: 'money', tags: ['money', 'tax'], weight: 0.33,
  },
  {
    id: 'm-refund-window',
    content:
      'A refund can be issued for ninety days after the charge. Past that the operation needs a support override, which is logged with the agent id.',
    memoryType: 'semantic', scope: 'project', project: BILLING,
    category: 'policy', tags: ['refunds', 'policy'], weight: 0.47,
  },
  {
    id: 'm-invoice-pdf-slow',
    content:
      'Invoice PDF rendering moved to a background worker after it pushed the request p95 past two seconds. The response now returns a job id the client polls.',
    memoryType: 'episodic', scope: 'project', project: BILLING,
    category: 'performance', tags: ['performance', 'invoices'], weight: 0.55,
  },
  {
    id: 'm-db-pool-exhaustion',
    content:
      'Long-running report queries drained the shared connection pool and starved ordinary requests. Reports were given a separate pool with a lower ceiling.',
    memoryType: 'episodic', scope: 'project', project: BILLING,
    category: 'performance', tags: ['postgres', 'performance'], weight: 0.44,
  },
  {
    id: 'm-currency-iso',
    content:
      'Currency codes are validated against ISO 4217 at the API boundary, so an unknown currency is rejected before it reaches the ledger.',
    memoryType: 'procedural', scope: 'project', project: BILLING,
    category: 'money', tags: ['money', 'validation'], weight: 0.91,
  },
  {
    id: 'm-index-missing',
    content:
      'A missing index on orders.customer_id made the account dashboard take eight seconds. Adding it brought the query under fifty milliseconds.',
    memoryType: 'episodic', scope: 'project', project: BILLING,
    category: 'performance', tags: ['postgres', 'performance'], weight: 0.37,
  },
  {
    id: 'm-csv-export-memory',
    content:
      'The CSV export streams rows to the response instead of collecting them in an array. A large tenant exhausted the pod memory and the process was killed mid-download.',
    memoryType: 'episodic', scope: 'project', project: BILLING,
    category: 'performance', tags: ['performance', 'export'], weight: 0.39,
  },
  {
    id: 'm-rate-limit',
    content:
      'The public API is rate limited per key with a token bucket. One integrator retry storm had taken the service down for everybody before the limit existed.',
    memoryType: 'architectural', scope: 'project', project: BILLING,
    category: 'reliability', tags: ['api', 'reliability'], weight: 0.29,
  },
  {
    id: 'm-retry-queue',
    content:
      'The job queue retries a failed job three times with exponential backoff and then moves it to a dead letter queue for a human to look at.',
    memoryType: 'architectural', scope: 'project', project: BILLING,
    category: 'reliability', tags: ['queue', 'retry'], weight: 0.88,
  },
  {
    id: 'm-queue-ordering',
    content:
      'The queue gives no ordering guarantee. Consumers are idempotent and reconcile by version number, because two attempts can arrive out of order.',
    memoryType: 'architectural', scope: 'project', project: BILLING,
    category: 'reliability', tags: ['queue'], weight: 0.72,
  },
  {
    id: 'm-timeout-grpc',
    content:
      'The gRPC client uses a two second deadline and a single retry. The default of no deadline starved the thread pool during an upstream slowdown.',
    memoryType: 'procedural', scope: 'project', project: BILLING,
    category: 'reliability', tags: ['grpc', 'retry'], weight: 0.84,
  },
  {
    id: 'm-cache-invalidation',
    content:
      'The product cache is invalidated by event rather than by time to live, because a stale price had already generated support tickets twice.',
    memoryType: 'architectural', scope: 'project', project: BILLING,
    category: 'caching', tags: ['cache'], weight: 0.51,
  },
  {
    id: 'm-search-typos',
    content:
      'Product search tolerates misspelled names through trigram similarity in Postgres, so a shopper who types a name wrong still finds the item.',
    memoryType: 'architectural', scope: 'project', project: BILLING,
    category: 'search', tags: ['search', 'postgres'], weight: 0.35,
  },
  {
    id: 'm-email-bounce',
    content:
      'A hard bounce unsubscribes the address automatically. Repeated sends to dead mailboxes were damaging the sending reputation of the whole domain.',
    memoryType: 'procedural', scope: 'project', project: BILLING,
    category: 'email', tags: ['email'], weight: 0.68,
  },
  {
    id: 'm-migration-backfill',
    content:
      'A large backfill runs in batches of a thousand rows with a pause between them, to keep replica lag under one second while it works.',
    memoryType: 'procedural', scope: 'project', project: BILLING,
    category: 'database', tags: ['postgres', 'migration'], weight: 0.76,
  },
  {
    id: 'm-locale-dates',
    content:
      'Timestamps are stored in UTC and rendered in the viewer timezone. A daylight saving bug had shifted every row in the monthly report by one hour.',
    memoryType: 'architectural', scope: 'project', project: BILLING,
    category: 'dates', tags: ['dates', 'i18n'], weight: 0.49,
  },
  {
    id: 'm-password-hash',
    content:
      'Passwords are hashed with Argon2id. Bcrypt was replaced during the security review because the work factor could not be raised far enough on the current hardware.',
    memoryType: 'architectural', scope: 'project', project: BILLING,
    category: 'security', tags: ['security', 'auth'], weight: 0.56,
  },

  // ── web-app ────────────────────────────────────────────────────────────────────────────
  {
    id: 'm-filter-state-url',
    content:
      'Filter state lives in the URL query string rather than component state, so a filtered view can be pasted into a chat and opened by somebody else.',
    memoryType: 'architectural', scope: 'project', project: WEBAPP,
    category: 'frontend', tags: ['react', 'routing'], weight: 0.43,
  },
  {
    id: 'm-form-autosave',
    content:
      'The long application form writes a draft to local storage every ten seconds. People were losing twenty minutes of typing when their session expired.',
    memoryType: 'architectural', scope: 'project', project: WEBAPP,
    category: 'frontend', tags: ['forms', 'ux'], weight: 0.52,
  },
  {
    id: 'm-image-lazy',
    content:
      'Product images below the fold are lazy-loaded. First contentful paint improved by forty percent on the catalogue page.',
    memoryType: 'episodic', scope: 'project', project: WEBAPP,
    category: 'performance', tags: ['performance', 'frontend'], weight: 0.31,
  },
  {
    id: 'm-a11y-focus-trap',
    content:
      'The modal keeps focus inside itself and hands focus back to the element that opened it. An audit found keyboard users stranded behind it with no way out.',
    memoryType: 'procedural', scope: 'project', project: WEBAPP,
    category: 'accessibility', tags: ['accessibility'], weight: 0.34,
  },
  {
    id: 'm-i18n-plural',
    content:
      'Plural forms come from Intl.PluralRules instead of a hand written switch on count, which produced wrong grammar in Polish and Russian.',
    memoryType: 'procedural', scope: 'project', project: WEBAPP,
    category: 'i18n', tags: ['i18n'], weight: 0.28,
  },
  {
    id: 'm-css-modules',
    content:
      'Styling is CSS modules rather than a runtime styled-components setup; the style recalculation showed up as a measurable cost in the profiler.',
    memoryType: 'architectural', scope: 'project', project: WEBAPP,
    category: 'frontend', tags: ['frontend', 'css'], weight: 0.66,
  },
  {
    id: 'm-feature-flags',
    content:
      'A feature flag is deleted within two sprints of full rollout. Three forgotten flags interacted during an incident and nobody could say which path production was on.',
    memoryType: 'procedural', scope: 'project', project: WEBAPP,
    category: 'process', tags: ['flags', 'process'], weight: 0.61,
  },
  {
    id: 'm-test-flake-clock',
    content:
      'A flaky test was freezing Date.now but not the database clock, so the two disagreed and the assertion failed roughly one run in ten.',
    memoryType: 'episodic', scope: 'project', project: WEBAPP,
    category: 'testing', tags: ['testing', 'flake'], weight: 0.45,
  },

  // ── infra ──────────────────────────────────────────────────────────────────────────────
  {
    id: 'm-terraform-state-lock',
    content:
      'Terraform state sits in S3 with a DynamoDB table for locking. Two engineers applying at the same moment had already corrupted it once.',
    memoryType: 'architectural', scope: 'project', project: INFRA,
    category: 'iac', tags: ['terraform', 'aws'], weight: 0.38,
  },
  {
    id: 'm-secrets-rotation',
    content:
      'Database credentials rotate every thirty days through Secrets Manager. The application re-reads them when a connection is refused instead of caching one value for the life of the process.',
    memoryType: 'architectural', scope: 'project', project: INFRA,
    category: 'security', tags: ['secrets', 'security'], weight: 0.42,
  },
  {
    id: 'm-blue-green',
    content:
      'Releases are blue-green with a five minute soak on the new colour before traffic moves across, and the old colour stays warm for a fast rollback.',
    memoryType: 'procedural', scope: 'project', project: INFRA,
    category: 'deploy', tags: ['deploy'], weight: 0.57,
  },
  {
    id: 'm-log-pii',
    content:
      'Request bodies are never written to the logs. A support ticket once carried a screenshot of CloudWatch showing a shopper card metadata in plain text.',
    memoryType: 'architectural', scope: 'project', project: INFRA,
    category: 'privacy', tags: ['logging', 'privacy'], weight: 0.36,
  },
  {
    id: 'm-alert-fatigue',
    content:
      'An alert fires only for a symptom a user would notice, never for CPU on its own. The old CPU threshold paged twice a week and everyone had learned to close it.',
    memoryType: 'architectural', scope: 'project', project: INFRA,
    category: 'observability', tags: ['observability'], weight: 0.63,
  },
  {
    id: 'm-cost-nat-gateway',
    content:
      'The NAT gateway was the single largest line on the AWS bill. VPC endpoints for S3 and DynamoDB removed most of that traffic and the charge with it.',
    memoryType: 'episodic', scope: 'project', project: INFRA,
    category: 'cost', tags: ['cost', 'aws'], weight: 0.32,
  },
  {
    id: 'm-oncall-runbook',
    content:
      'Every alert links to the runbook section that explains what to do about it. An alert without one is not allowed to page a human.',
    memoryType: 'procedural', scope: 'project', project: INFRA,
    category: 'observability', tags: ['observability', 'oncall'], weight: 0.74,
  },
  {
    id: 'm-staging-data',
    content:
      'Staging runs on synthetic data and never on a production dump. A dump had leaked real addresses into a test notification batch that actually sent.',
    memoryType: 'procedural', scope: 'project', project: INFRA,
    category: 'privacy', tags: ['privacy', 'staging'], weight: 0.69,
  },
  {
    id: 'm-k8s-requests',
    content:
      'Every pod declares CPU and memory requests. Without them the scheduler packed nodes until the kubelet started evicting under pressure.',
    memoryType: 'procedural', scope: 'project', project: INFRA,
    category: 'kubernetes', tags: ['kubernetes'], weight: 0.59,
  },

  // ── person scope — how I work ──────────────────────────────────────────────────────────
  {
    id: 'm-pref-small-prs',
    content:
      'I want pull requests under about four hundred lines. The large ones get approved in a minute with no comments, which means nobody read them.',
    memoryType: 'semantic', scope: 'person',
    category: 'preference', tags: ['review', 'process'], weight: 0.46, confirmed: true,
  },
  {
    id: 'm-pref-conventional-commits',
    content:
      'Commit messages follow Conventional Commits, and the body says why the change was made rather than restating what the diff shows.',
    memoryType: 'semantic', scope: 'person',
    category: 'preference', tags: ['git', 'process'], weight: 0.54, confirmed: true,
  },
  {
    id: 'm-pref-no-mocks',
    content:
      'I avoid mocks and reach for a fake instead. A suite that mocks everything stayed green for weeks while the real integration was broken.',
    memoryType: 'semantic', scope: 'person',
    category: 'preference', tags: ['testing'], weight: 0.27, confirmed: true,
  },
  {
    id: 'm-pref-tdd-bugfix',
    content:
      'For a defect I write the failing test first, every time. A fix without a red test ahead of it is a guess about what was wrong.',
    memoryType: 'semantic', scope: 'person',
    category: 'preference', tags: ['testing', 'process'], weight: 0.48, confirmed: true,
  },
  {
    id: 'm-pref-language-split',
    content:
      'I reason about design in Spanish and write the code, the commits and the documents in English.',
    memoryType: 'semantic', scope: 'person',
    category: 'preference', tags: ['language'], weight: 0.53, confirmed: true,
  },
  {
    id: 'm-pref-no-release-friday',
    content:
      'We do not ship on a Friday. The last two incidents that ran into a weekend both started with a Friday afternoon deploy.',
    memoryType: 'semantic', scope: 'person',
    category: 'preference', tags: ['deploy', 'process'], weight: 0.71,
  },

  // ── lessons ────────────────────────────────────────────────────────────────────────────
  {
    id: 'm-lesson-pipe-exit',
    content:
      'Reading the exit status after a pipe gives the status of the last command, not of the pipeline. A zero from tail hid a build that had actually failed.',
    memoryType: 'insight', scope: 'person',
    category: 'lesson', tags: ['shell', 'lesson'], weight: 0.26,
  },
  {
    id: 'm-lesson-create-if-not-exists',
    content:
      'CREATE TABLE IF NOT EXISTS does nothing at all to a database that already exists, so adding a column to the schema file is not a migration and never reaches an existing store.',
    memoryType: 'insight', scope: 'person',
    category: 'lesson', tags: ['sql', 'lesson'], weight: 0.64,
  },
  {
    id: 'm-lesson-green-gate',
    content:
      'A gate that has never failed has not been verified. Make it fail on purpose once, or the green tick is only evidence that it ran.',
    memoryType: 'insight', scope: 'person',
    category: 'lesson', tags: ['gates', 'lesson'], weight: 0.30,
  },
  {
    id: 'm-lesson-one-sample',
    content:
      'One reading is not a measurement, and a median of five is not one either when the series is still warming up. Report the spread or say nothing.',
    memoryType: 'insight', scope: 'person',
    category: 'lesson', tags: ['benchmark', 'lesson'], weight: 0.25,
  },
  {
    id: 'm-lesson-cast-not-conversion',
    content:
      'A TypeScript cast is an assertion, not a conversion. The driver handed back a Date where the code claimed a string and the bind failed only against the real engine.',
    memoryType: 'insight', scope: 'person',
    category: 'lesson', tags: ['typescript', 'lesson'], weight: 0.40,
  },
  {
    id: 'm-lesson-adr-why',
    content:
      'A decision record says why, not what. The diff already shows what changed, and a record that restates it adds a maintenance cost with no reader value.',
    memoryType: 'insight', scope: 'person',
    category: 'lesson', tags: ['docs', 'lesson'], weight: 0.50,
  },

  // ── coordination ───────────────────────────────────────────────────────────────────────
  {
    id: 'm-coord-gabo-leaders',
    content:
      'Gabriel has the leaders surface this sprint. I keep out of that directory so we are not resolving the same conflict twice.',
    memoryType: 'coordination', scope: 'project', project: BILLING,
    category: 'team', tags: ['team', 'ownership'], weight: 0.60,
  },
  {
    id: 'm-coord-onboarding',
    content:
      'A new engineer ships a one line change on the first day, so the whole pipeline from clone to production gets exercised while somebody is watching.',
    memoryType: 'coordination', scope: 'project', project: INFRA,
    category: 'team', tags: ['team', 'onboarding'], weight: 0.67,
  },
];

/** Fixture ids, for assertions that every labelled target actually exists. */
export const FIXTURE_IDS: ReadonlySet<string> = new Set(FIXTURE.map((m) => m.id));
