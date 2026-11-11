/**
 * The pool-scale de-duplication corpus — the decision the service actually makes.
 *
 * ## Why the pairwise experiment is not enough to pick a threshold
 *
 * `pairs.ts` measures a **pairwise** question: given two memories, are they the same knowledge?
 * `TeamPromotionService.promote` asks something different and harder: given one candidate and a
 * pool of everything the team already has, is the candidate already covered? It answers by taking
 * the **maximum** similarity over the whole pool and comparing that to the threshold.
 *
 * A maximum over N draws grows with N. So a threshold tuned to maximise pairwise F1 — 0.10 for
 * every method measured — can be badly wrong in service: against a pool of a thousand memories,
 * almost any novel candidate will find *something* scoring above 0.10 by coincidence and be
 * silently suppressed. The pairwise best-F1 threshold is therefore a lower bound on a sane
 * operating point, not the operating point, and choosing one without measuring this would have
 * been the kind of mistake that only shows up as "the team stopped receiving my memories".
 *
 * ## The design
 *
 * The pool is the 51-memory fixture from `../lib/fixture.ts` — the same store the recall
 * experiment uses, so neither corpus has to be maintained twice.
 *
 * **True duplicates** are not newly labelled. Eleven of the duplicate pairs in `pairs.ts` have a
 * `b` side that restates a memory already in the fixture, so `DUPLICATE_OF` simply records which
 * fixture id each one duplicates. The hard labelling was done once, in `pairs.ts`, and this file
 * reuses it rather than re-deciding it.
 *
 * **Novel candidates** are new, and deliberately easy: twelve memories whose subject does not
 * appear in the fixture at all. Easy is the point — if a method suppresses one of these, it would
 * suppress anything. A hard novel case would conflate "the threshold is too low" with "this was
 * arguably a duplicate", and the question here is only the first.
 */

/**
 * Which fixture memory each duplicate pair's `b` side restates.
 *
 * Keyed by pair id in `pairs.ts`; the value is the fixture id in `../lib/fixture.ts`. A
 * de-duplicator given the `b` text against the full fixture SHOULD suppress it, and the pool
 * entry it names is the one it should point at.
 */
export const DUPLICATE_OF: Record<string, string> = {
  'dup-money-cents': 'm-money-integers',
  'dup-no-friday': 'm-pref-no-release-friday',
  'dup-idempotency': 'm-stripe-idempotency',
  'dup-terraform-lock': 'm-terraform-state-lock',
  'dup-small-prs': 'm-pref-small-prs',
  'dup-pipe-exit': 'm-lesson-pipe-exit',
  'dup-argon2': 'm-password-hash',
  'dup-blue-green-detail': 'm-blue-green',
  'dup-backfill-detail': 'm-migration-backfill',
  'dup-alert-symptom': 'm-alert-fatigue',
  'dup-lazy-images': 'm-image-lazy',
};

/** A memory whose subject is absent from the fixture. Suppressing it is a false positive. */
export interface NovelCandidate {
  id: string;
  content: string;
  /** Why this is genuinely new knowledge relative to the 51-memory pool. */
  description: string;
}

export const NOVEL: NovelCandidate[] = [
  {
    id: 'new-websocket-backpressure',
    content:
      'The websocket server drops the oldest queued frame when a client falls more than two hundred messages behind, because buffering without a bound turned one slow phone into a memory leak on the node.',
    description: 'Nothing in the pool concerns websockets, backpressure or frame queues.',
  },
  {
    id: 'new-pdf-font-subset',
    content:
      'Generated PDFs embed a subset of the font rather than the whole file, which took the average document from nine hundred kilobytes to seventy.',
    description: 'The pool has a PDF memory, but about moving rendering to a worker — not fonts or file size.',
  },
  {
    id: 'new-timezone-import',
    content:
      'The timezone database is pinned and updated deliberately rather than taken from the host, so two machines never disagree about when a rule changed.',
    description: 'The pool stores timestamps in UTC; where the tz database comes from is a separate decision.',
  },
  {
    id: 'new-ab-test-assignment',
    content:
      'Experiment assignment is a hash of the user id and the experiment name, so a user stays in the same arm without storing anything.',
    description: 'No memory in the pool concerns experiments, cohorts or assignment.',
  },
  {
    id: 'new-sso-group-mapping',
    content:
      'SSO group names map to internal roles through a table an administrator edits, never by parsing the group string, because the identity provider renamed a group and silently removed everyone access.',
    description: 'The pool has auth memories about password hashing; nothing about SSO or group mapping.',
  },
  {
    id: 'new-image-exif-strip',
    content:
      'Uploaded images have their EXIF stripped before storage, after a seller photo turned out to carry the GPS coordinates of their home.',
    description: 'The pool has privacy memories about logs and staging data; nothing about image metadata.',
  },
  {
    id: 'new-cursor-pagination',
    content:
      'List endpoints paginate by opaque cursor rather than offset, because an offset page shifts under the reader whenever a row is inserted above it.',
    description: 'No memory in the pool concerns pagination.',
  },
  {
    id: 'new-webhook-retry-budget',
    content:
      'Outbound webhooks to a customer endpoint get a six hour retry budget and then stop, and the endpoint is marked unhealthy on the integrations page so somebody can see it.',
    description: 'The pool has inbound Stripe webhooks and an internal job queue; an outbound delivery budget is neither.',
  },
  {
    id: 'new-db-read-replica-lag',
    content:
      'A read that follows a write in the same request goes to the primary, because the replica was far enough behind that a user saw their own change missing.',
    description: 'The pool mentions replica lag during a backfill; read-after-write routing is a different decision.',
  },
  {
    id: 'new-mobile-offline-queue',
    content:
      'The mobile client queues writes while offline and replays them with the original client timestamp, so a reconnect does not reorder a day of work.',
    description: 'Nothing in the pool concerns mobile clients or offline behaviour.',
  },
  {
    id: 'new-sitemap-generation',
    content:
      'The sitemap is generated nightly from the catalogue rather than on request, which stopped a crawler from holding a database connection for ninety seconds at a time.',
    description: 'No memory in the pool concerns crawlers, SEO or sitemaps.',
  },
  {
    id: 'new-contract-pdf-signature',
    content:
      'A signed contract stores the hash of the exact bytes that were signed, so a later template change cannot alter what somebody agreed to.',
    description: 'No memory in the pool concerns signatures or document integrity.',
  },
];
