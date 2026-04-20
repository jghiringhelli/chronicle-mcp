/**
 * Chronicle Domain Types
 *
 * Core type definitions for the five-memory model.
 * Domain layer has zero external imports.
 */

/**
 * The six cognitive memory types.
 *
 * Pick the type that matches HOW the AI should treat this knowledge:
 *
 * - episodic:      Something that happened. Events, bugs, decisions made at a point in time.
 *                  Decays fast (half-life ~7 days). Use for: "Auth broke after Lucia upgrade",
 *                  "Deployed at 14:00, rolled back at 14:15".
 *
 * - semantic:      Something that is true about the world or the codebase right now.
 *                  Decays slowly (half-life ~35 days). Use for: "Railway does not persist /tmp",
 *                  "pnpm is our package manager", "the API rate limit is 100 req/min".
 *                  Add confirmed:true to make it permanent (decay = 0).
 *
 * - procedural:    How to do something. Step-by-step sequences, commands, workflows.
 *                  Never decays. Starts in Core. Use for: "To run migrations: railway run prisma migrate deploy",
 *                  "Deploy sequence: build → test → railway up → check logs".
 *
 * - architectural: Why something is built the way it is. ADRs, tradeoffs, rejected alternatives.
 *                  Never decays. Starts in Core. Use for: "Chose better-sqlite3 over Prisma —
 *                  sync API, no ORM overhead, fits our domain model".
 *
 * - insight:       A synthesised pattern about the developer or team. Cross-session learning.
 *                  Never decays. Starts in Core. Set by the distill tool or explicitly when a
 *                  pattern becomes clear. Use for: "You consistently forget migrations before deploy",
 *                  "This team always uses functional patterns, never classes".
 *
 * - coordination:  Live team coordination state — who owns what, work package assignments,
 *                  dependency graph snapshots. Decays slowly (half-life ~70 days). Starts in
 *                  Working. Use for: "Alice owns auth service in sprint 3",
 *                  "merge-gate blocked until Chronicle v0.2 ships".
 */
export type MemoryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'architectural'
  | 'insight'
  | 'coordination';

/** Storage tiers based on access frequency and permanence */
export type StorageTier =
  | 'buffer'   // Short-term, 7-day TTL if never accessed
  | 'working'  // Promoted from buffer, decays slowly
  | 'core';    // Permanent, never decays

/** Trigger actions for the trigger system (F2) */
export type TriggerAction =
  | 'deploy'
  | 'publish'
  | 'refactor'
  | 'delete'
  | 'migrate'
  | string; // custom triggers

/** Trigger severity levels */
export type TriggerSeverity = 'critical' | 'warning' | 'info';

/** Unique identifier for a memory */
export type MemoryId = string;

/** Unique identifier for a project */
export type ProjectId = string;

/** Unique identifier for a trigger */
export type TriggerId = string;

/** Unique identifier for a session */
export type SessionId = string;

/** ISO 8601 timestamp string */
export type Timestamp = string;

/** Vector embedding for semantic search */
export type Embedding = number[];

/** Weight value between 0.0 and 1.0 */
export type Weight = number;

/** Decay rate (0.0 = never decays, higher = faster decay) */
export type DecayRate = number;

/**
 * Decay rates by memory type
 * From spec.md Section 3.2
 */
export const DECAY_RATES: Record<MemoryType, DecayRate> = {
  episodic:     0.10, // Half-life ~7 days — events fade
  semantic:     0.02, // Half-life ~35 days — facts linger (confirmed:true → 0.00)
  procedural:   0.00, // Never decays — how-to knowledge is permanent
  architectural:0.00, // Never decays — decisions are permanent
  insight:      0.00, // Never decays — synthesised patterns about the developer
  coordination: 0.01, // Half-life ~70 days — team state fades as work completes
} as const;

/**
 * Default storage tiers by memory type
 * Procedural and Architectural skip to Core immediately
 */
export const DEFAULT_TIERS: Record<MemoryType, StorageTier> = {
  episodic:     'buffer',  // Promote as accessed
  semantic:     'working', // Promote as accessed; confirmed:true → core
  procedural:   'core',    // Always permanent
  architectural:'core',    // Always permanent
  insight:      'core',    // Always permanent — synthesised knowledge
  coordination: 'working', // Active team state; decays as work completes
} as const;

/**
 * Reinforcement boost values from spec.md Section 3.2
 */
export const REINFORCEMENT_BOOSTS = {
  /** Trigger check surfaced it */
  TRIGGER_HIT: 0.20,
  /** Explicit recall hit */
  RECALL_HIT: 0.15,
  /** Distill cycle selected it */
  DISTILL_SELECT: 0.10,
  /** Context injection (passive) */
  CONTEXT_INJECT: 0.05,
  /** Manual confirmed remember */
  CONFIRMED_REMEMBER: 0.25,
} as const;
