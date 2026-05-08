/**
 * Chronicle library entry — programmatic API for embedding Chronicle in-process.
 *
 * The underlying behavior lives in the MCP tool handlers (`src/mcp/server.ts`)
 * and the services they wire (`src/services/*`). This module is the
 * thin façade that surfaces those handlers as ordinary TypeScript methods,
 * so callers can use Chronicle without speaking MCP.
 *
 * Scope:
 *   - `global`  → SQLite DB at `~/.chronicle/` (the default install location).
 *   - `project` → SQLite DB at `<projectRoot>/.chronicle/`, isolating memory
 *                 to a single repo. Use `ChronicleClient.forProject(root)`.
 */

import type { MemoryType } from '../domain/types.js';

export interface ChronicleClientOptions {
  /** `global` reads/writes ~/.chronicle/, `project` reads/writes <projectRoot>/.chronicle/. */
  scope: 'global' | 'project';
  /** Required when scope is `project`. Absolute path to the repo root. */
  projectRoot?: string;
}

export interface RememberInput {
  content: string;
  memoryType?: MemoryType;
  project?: string;
  category?: string;
  tags?: string[];
  /** Permanent truth — zero decay, Core tier. */
  confirmed?: boolean;
}

export interface RecallInput {
  query: string;
  project?: string;
  category?: string;
  memoryTypes?: MemoryType[];
  tiers?: Array<'buffer' | 'working' | 'core'>;
  limit?: number;
}

/**
 * In-process client for Chronicle.
 *
 * Mirrors the MCP `chronicle` and `session` tool surface so library consumers
 * can call the same operations without an MCP transport in between.
 */
export class ChronicleClient {
  readonly scope: 'global' | 'project';
  readonly projectRoot?: string;

  constructor(options: ChronicleClientOptions) {
    if (options.scope === 'project' && !options.projectRoot) {
      throw new Error('ChronicleClient: projectRoot is required when scope is "project".');
    }
    this.scope = options.scope;
    this.projectRoot = options.projectRoot;
  }

  /** Build a project-scoped client. DB lives at `<projectRoot>/.chronicle/`. */
  static forProject(projectRoot: string): ChronicleClient {
    return new ChronicleClient({ scope: 'project', projectRoot });
  }

  /** Store a memory. Returns `{ id, tier, weight }`. */
  remember(_input: RememberInput): Promise<unknown> {
    throw new Error('ChronicleClient.remember: not implemented');
  }

  /** Search memories by query, project, category, type, or tier. */
  recall(_input: RecallInput): Promise<unknown[]> {
    throw new Error('ChronicleClient.recall: not implemented');
  }

  /** Delete a memory by id. `context` is recorded for audit. */
  forget(_id: string, _context?: string): Promise<void> {
    throw new Error('ChronicleClient.forget: not implemented');
  }

  /** Set an action-keyword trigger that fires the linked memory on `checkTriggers`. */
  setTrigger(_input: {
    action: string;
    content: string;
    severity?: 'critical' | 'warning' | 'info';
    memoryId?: string;
  }): Promise<unknown> {
    throw new Error('ChronicleClient.setTrigger: not implemented');
  }

  /** Fire all triggers matching `action` (and optionally `project`). */
  checkTriggers(_action: string, _project?: string): Promise<unknown[]> {
    throw new Error('ChronicleClient.checkTriggers: not implemented');
  }

  /** Persist a developer preference (key/value, optional context + strength). */
  setPreference(_input: {
    key: string;
    value: string;
    context?: string;
    strength?: 'strong' | 'moderate' | 'weak';
    project?: string;
  }): Promise<void> {
    throw new Error('ChronicleClient.setPreference: not implemented');
  }

  /** Get all preferences, optionally filtered by project or relevance to a context. */
  getPreferences(_input?: { project?: string; context?: string }): Promise<unknown[]> {
    throw new Error('ChronicleClient.getPreferences: not implemented');
  }

  /** Memory counts by tier (and total). Optionally scoped to a project. */
  stats(_project?: string): Promise<unknown> {
    throw new Error('ChronicleClient.stats: not implemented');
  }

  /** Begin a Chronicle session — returns the session plus injected core memories. */
  startSession(_project: string, _device?: string): Promise<unknown> {
    throw new Error('ChronicleClient.startSession: not implemented');
  }

  /** End a session. Runs decay + tier-promotion as maintenance. */
  endSession(_id: string, _summary?: string): Promise<unknown> {
    throw new Error('ChronicleClient.endSession: not implemented');
  }
}
