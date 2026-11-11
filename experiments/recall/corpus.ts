/**
 * The labelled recall corpus — 35 hand-written queries over the 51-memory fixture.
 *
 * Shape and conventions follow CodeSeeker's `tests/relevance/corpus.ts`: a case is a query,
 * the targets that MUST come back, a rank ceiling, and tags for grouped analysis. Two things
 * are different because the subject is different:
 *
 * - Targets are fixture **ids**, not filename substrings. A memory has no path.
 * - There is an explicit `expectEmpty` class. Code search always has some nearest file; a
 *   memory store legitimately holds nothing about Bluetooth, and returning something anyway is
 *   the failure mode that makes an assistant cite a memory that does not apply.
 *
 * ## How the labels were decided
 *
 * Each query was written first, as the question a developer would actually type, and only then
 * were the fixture memories read to decide which ones answer it. A memory is a target when it
 * answers the question on its own; a memory that is merely on the same topic is deliberately
 * NOT a target — `m-lesson-green-gate` is not labelled for "a test that passes while the real
 * thing is broken", because it is about gates rather than about test doubles, and labelling the
 * neighbourhood instead of the answer is how a corpus stops discriminating.
 *
 * The seven tag groups exist so that a configuration can win overall and still be shown to
 * lose somewhere, which is the result most worth reporting.
 */

/** Query classes, used for the per-group breakdown in the report. */
export type QueryTag =
  /** The target's own words are in the query. The keyword path should already win these. */
  | 'exact-keyword'
  /** Same word, different form: rotating/rotate, migrating/migration. `LIKE` cannot match. */
  | 'morphology'
  /** Same meaning, different words. No lexical overlap with the target by design. */
  | 'paraphrase'
  /** One key term swapped for a synonym: dialog/modal, misspelled/typo. */
  | 'synonym'
  /** An exact match exists with a LOW weight while a high-weight distractor shares a word. */
  | 'ranking'
  /** Several memories are relevant — this is what R@5 is for. */
  | 'multi-relevant'
  /** Nothing in the store answers it. Returning anything is a false positive. */
  | 'out-of-scope';

export interface RecallCase {
  id: string;
  /** The query as a developer would type it. */
  query: string;
  /** Fixture ids that must be returned. Empty for `out-of-scope`. */
  mustFind: string[];
  /** Every `mustFind` id must land at or above this 1-based rank for the case to "pass". */
  maxRank: number;
  /** When true, any returned result is a false positive. */
  expectEmpty?: boolean;
  tags: QueryTag[];
  /** Why these targets and not others — the labelling rationale, kept with the label. */
  description: string;
}

export const RECALL_CORPUS: RecallCase[] = [
  // ── exact-keyword: the baseline's home ground ──────────────────────────────────────────
  {
    id: 'kw-idempotency',
    query: 'idempotency key stripe charge',
    mustFind: ['m-stripe-idempotency'],
    maxRank: 3,
    tags: ['exact-keyword'],
    description: 'Every query word but one appears verbatim in the target.',
  },
  {
    id: 'kw-terraform-lock',
    query: 'terraform state locking dynamodb',
    mustFind: ['m-terraform-state-lock'],
    maxRank: 2,
    tags: ['exact-keyword'],
    description: 'Terraform, state, locking and DynamoDB are all in the target.',
  },
  {
    id: 'kw-argon2id',
    query: 'argon2id password hashing',
    mustFind: ['m-password-hash'],
    maxRank: 2,
    tags: ['exact-keyword'],
    description: 'A rare token (argon2id) occurring in exactly one memory.',
  },
  {
    id: 'kw-nat-gateway',
    query: 'nat gateway aws bill',
    mustFind: ['m-cost-nat-gateway'],
    maxRank: 2,
    tags: ['exact-keyword', 'ranking'],
    description:
      'Exact tokens, but the target has weight 0.32 — the lowest-weighted exact match in the fixture.',
  },
  {
    id: 'kw-conventional-commits',
    query: 'conventional commits',
    mustFind: ['m-pref-conventional-commits'],
    maxRank: 2,
    tags: ['exact-keyword'],
    description: 'A two-word exact phrase present in one memory.',
  },
  {
    id: 'kw-trigram-search',
    query: 'trigram similarity postgres',
    mustFind: ['m-search-typos'],
    maxRank: 2,
    tags: ['exact-keyword'],
    description: 'Trigram appears once; postgres appears in four memories as a distractor.',
  },

  // ── morphology: the same word in another form ─────────────────────────────────────────
  {
    id: 'morph-migrating-column',
    query: 'migrating a schema by adding a column',
    mustFind: ['m-lesson-create-if-not-exists'],
    maxRank: 3,
    tags: ['morphology'],
    description:
      'Target says "migration" and "column"; the query says "migrating". A substring LIKE cannot bridge migrating → migration.',
  },
  {
    id: 'morph-rotating-credentials',
    query: 'rotating the database credentials',
    mustFind: ['m-secrets-rotation'],
    maxRank: 2,
    tags: ['morphology'],
    description: 'Target says "rotate"; the query says "rotating".',
  },
  {
    id: 'morph-lazily-loading',
    query: 'lazily loading images',
    mustFind: ['m-image-lazy'],
    maxRank: 3,
    tags: ['morphology'],
    description: 'Target says "lazy-loaded"; the query says "lazily loading".',
  },
  {
    id: 'morph-retrying-jobs',
    query: 'retrying a failed job',
    mustFind: ['m-retry-queue'],
    maxRank: 3,
    tags: ['morphology'],
    description:
      'Target says "retries a failed job"; the query says "retrying". Three other memories contain "retry".',
  },
  {
    id: 'morph-pluralization',
    query: 'pluralization for other languages',
    mustFind: ['m-i18n-plural'],
    maxRank: 3,
    tags: ['morphology'],
    description: 'Target says "Plural forms"; the query says "pluralization".',
  },

  // ── paraphrase: same meaning, no shared vocabulary ────────────────────────────────────
  {
    id: 'para-double-charge',
    query: 'how do we avoid billing a customer twice',
    mustFind: ['m-stripe-idempotency'],
    maxRank: 3,
    tags: ['paraphrase'],
    description:
      'The target explains exactly this, and shares only "customer" and "bill" with the query.',
  },
  {
    id: 'para-why-not-floats',
    query: 'why are amounts not floating point numbers',
    mustFind: ['m-money-integers'],
    maxRank: 2,
    tags: ['paraphrase'],
    description: 'Target names the one-cent discrepancy that caused the decision.',
  },
  {
    id: 'para-two-people-infra',
    query: 'what stops two people from breaking the infrastructure at the same time',
    mustFind: ['m-terraform-state-lock'],
    maxRank: 3,
    tags: ['paraphrase'],
    description:
      'Target is the locking decision and names the corruption it prevents; it never says "infrastructure".',
  },
  {
    id: 'para-customer-data-logs',
    query: 'customer data must not end up where we can read it later',
    mustFind: ['m-log-pii'],
    maxRank: 3,
    tags: ['paraphrase'],
    description: 'Target is the no-request-bodies-in-logs rule.',
  },
  {
    id: 'para-rubber-stamped',
    query: 'big code reviews get approved without anyone reading them',
    mustFind: ['m-pref-small-prs'],
    maxRank: 3,
    tags: ['paraphrase'],
    description: 'Target states this as the reason for the size limit, in different words.',
  },
  {
    id: 'para-green-but-broken',
    query: 'the suite passes but the real integration is broken',
    mustFind: ['m-pref-no-mocks'],
    maxRank: 3,
    tags: ['paraphrase'],
    description:
      'Target is the mocks preference, which names this exact outcome. The gate lesson is on the same theme and is deliberately not labelled.',
  },
  {
    id: 'para-noisy-alerts',
    query: 'people ignore the monitoring because it cries wolf',
    mustFind: ['m-alert-fatigue'],
    maxRank: 3,
    tags: ['paraphrase'],
    description: 'Target is the symptom-only alert rule and the CPU alert nobody read.',
  },
  {
    id: 'para-lost-typing',
    query: 'users lose what they typed when they take too long',
    mustFind: ['m-form-autosave'],
    maxRank: 3,
    tags: ['paraphrase'],
    description: 'Target is the autosave decision and names the session expiry.',
  },

  // ── synonym: one key term swapped ─────────────────────────────────────────────────────
  {
    id: 'syn-stale-prices',
    query: 'clearing out stale product prices',
    mustFind: ['m-cache-invalidation'],
    maxRank: 3,
    tags: ['synonym'],
    description: '"clearing out" for "invalidated"; the target names the stale price tickets.',
  },
  {
    id: 'syn-one-client-overwhelms',
    query: 'stop a single integrator from overwhelming the service',
    mustFind: ['m-rate-limit'],
    maxRank: 3,
    tags: ['synonym', 'ranking'],
    description:
      'Target is the rate limit, at weight 0.29 — the lowest in the fixture — against high-weight retry distractors.',
  },
  {
    id: 'syn-stuck-in-dialog',
    query: 'keyboard users getting stuck inside a dialog',
    mustFind: ['m-a11y-focus-trap'],
    maxRank: 3,
    tags: ['synonym'],
    description: '"dialog" for "modal"; the rest of the query matches the target closely.',
  },
  {
    id: 'syn-misspelled-names',
    query: 'shoppers who spell the product name wrong',
    mustFind: ['m-search-typos'],
    maxRank: 3,
    tags: ['synonym'],
    description: 'Target says "misspelled" and "types a name wrong".',
  },
  {
    id: 'syn-rollback-fast',
    query: 'getting back to the previous version quickly',
    mustFind: ['m-blue-green'],
    maxRank: 3,
    tags: ['synonym'],
    description: 'Target names the warm old colour kept for a fast rollback.',
  },

  // ── ranking: relevance versus weight ─────────────────────────────────────────────────
  {
    id: 'rank-retry-storm',
    query: 'retry storm',
    mustFind: ['m-rate-limit'],
    maxRank: 1,
    tags: ['ranking', 'exact-keyword'],
    description:
      '"retry storm" is a verbatim phrase in exactly one memory, weight 0.29. Three memories with weights 0.84–0.88 contain "retry" and nothing else from the query.',
  },
  {
    id: 'rank-dead-letter',
    query: 'dead letter queue',
    mustFind: ['m-retry-queue'],
    maxRank: 1,
    tags: ['ranking', 'exact-keyword'],
    description:
      'The verbatim phrase is in one memory, which happens to be high-weight — the control for the previous case.',
  },
  {
    id: 'rank-connection-pool',
    query: 'connection pool exhausted',
    mustFind: ['m-db-pool-exhaustion'],
    maxRank: 2,
    tags: ['ranking'],
    description:
      'Target (0.44) says "drained the shared connection pool"; m-secrets-rotation (0.42) says "connection is refused" and competes on one word.',
  },

  // ── multi-relevant: what R@5 measures ────────────────────────────────────────────────
  {
    id: 'multi-money-rounding',
    query: 'money precision and rounding',
    mustFind: ['m-money-integers', 'm-tax-rounding'],
    maxRank: 5,
    tags: ['multi-relevant'],
    description: 'Integer cents and half-up line rounding are both answers; both must surface.',
  },
  {
    id: 'multi-performance-fixes',
    query: 'performance problems we have actually fixed',
    mustFind: ['m-invoice-pdf-slow', 'm-image-lazy', 'm-index-missing', 'm-csv-export-memory'],
    maxRank: 5,
    tags: ['multi-relevant'],
    description:
      'Four episodic memories each record a fixed performance problem. m-db-pool-exhaustion is a fifth candidate and is excluded from the label on purpose, to keep one relevant item outside the ceiling.',
  },
  {
    id: 'multi-how-we-deploy',
    query: 'how we release to production',
    mustFind: ['m-blue-green', 'm-pref-no-release-friday'],
    maxRank: 5,
    tags: ['multi-relevant', 'paraphrase'],
    description: 'The mechanism and the timing rule are both part of the answer.',
  },
  {
    id: 'multi-testing-prefs',
    query: 'my testing preferences',
    mustFind: ['m-pref-no-mocks', 'm-pref-tdd-bugfix'],
    maxRank: 5,
    tags: ['multi-relevant'],
    description: 'Two person-scope preferences about tests; neither contains the word "preferences".',
  },
  {
    id: 'multi-green-check',
    query: 'what we learned about trusting a green check',
    mustFind: ['m-lesson-green-gate', 'm-lesson-pipe-exit'],
    maxRank: 5,
    tags: ['multi-relevant', 'paraphrase'],
    description:
      'The gate that never failed and the zero that came from tail are both lessons about a false green.',
  },

  // ── out-of-scope: nothing here answers it ────────────────────────────────────────────
  {
    id: 'empty-bluetooth',
    query: 'bluetooth pairing on android',
    mustFind: [],
    maxRank: 0,
    expectEmpty: true,
    tags: ['out-of-scope'],
    description: 'No memory touches Bluetooth, pairing or Android.',
  },
  {
    id: 'empty-capital-france',
    query: 'what is the capital of France',
    mustFind: [],
    maxRank: 0,
    expectEmpty: true,
    tags: ['out-of-scope'],
    description:
      'A general-knowledge question. The store holds nothing about it and should say so by returning nothing.',
  },
  {
    id: 'empty-kafka-partitions',
    query: 'kafka partition rebalancing strategy',
    mustFind: [],
    maxRank: 0,
    expectEmpty: true,
    tags: ['out-of-scope'],
    description:
      'The fixture has queues but no Kafka. A config that answers this is pattern-matching on "queue" and should be penalised for it.',
  },
];
