/**
 * Chronicle Domain Types
 *
 * Core type definitions for the five-memory model.
 * Domain layer has zero external imports.
 */

/** The five cognitive memory types (Tulving, 1972, 1985; Squire, 1987) */
export type MemoryType =
  | 'episodic'      // What happened — autobiographical events
  | 'semantic'      // What is true — factual domain knowledge
  | 'procedural'    // How to do it — step-by-step solutions
  | 'session'       // What is active now — live context
  | 'architectural'; // Why it is built this way — design decisions

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
  episodic: 0.10,      // Half-life ~7 days
  semantic: 0.02,      // Half-life ~35 days
  procedural: 0.00,    // Never decays
  session: 0.10,       // Ephemeral, 7-day TTL (treated like episodic)
  architectural: 0.00, // Never decays
} as const;

/**
 * Default storage tiers by memory type
 * Procedural and Architectural skip to Core immediately
 */
export const DEFAULT_TIERS: Record<MemoryType, StorageTier> = {
  episodic: 'buffer',
  semantic: 'working',
  procedural: 'core',
  session: 'buffer',
  architectural: 'core',
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
