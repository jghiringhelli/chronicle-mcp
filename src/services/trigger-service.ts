/**
 * TriggerService — manages action triggers stored directly in the DB.
 */

import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { StorageError } from '../shared/exceptions/index.js';

interface TriggerRow {
  id: string;
  memory_id: string | null;
  action: string;
  content: string;
  severity: string;
  created_at: string;
  active: number;
}

export interface TriggerResult {
  id: string;
  action: string;
  content: string;
  severity: string;
  memoryId?: string;
}

export class TriggerService {
  constructor(private db: Database.Database) {}

  /**
   * Set an action trigger.
   *
   * @param input - Trigger parameters
   * @returns New trigger ID
   */
  setTrigger(input: {
    memoryId?: string;
    action: string;
    content: string;
    severity?: string;
  }): string {
    const id = `trig_${crypto.randomUUID()}`;
    try {
      this.db.prepare(`
        INSERT INTO triggers (id, memory_id, action, content, severity, created_at, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(
        id,
        input.memoryId ?? null,
        input.action,
        input.content,
        input.severity ?? 'warning',
        new Date().toISOString(),
      );
    } catch (err) {
      throw new StorageError('Failed to set trigger', err);
    }
    return id;
  }

  /**
   * Check active triggers for an action.
   *
   * @param action - Action to check
   * @param _project - Optional project filter (unused for now)
   * @returns Matching triggers
   */
  checkTriggers(action: string, _project?: string): TriggerResult[] {
    try {
      const rows = this.db.prepare(`
        SELECT id, memory_id, action, content, severity FROM triggers
        WHERE action = ? AND active = 1
      `).all(action) as TriggerRow[];
      return rows.map(row => ({
        id: row.id,
        action: row.action,
        content: row.content,
        severity: row.severity,
        memoryId: row.memory_id ?? undefined,
      }));
    } catch (err) {
      throw new StorageError('Failed to check triggers', err);
    }
  }

  /**
   * Deactivate a trigger.
   *
   * @param id - Trigger identifier
   */
  removeTrigger(id: string): void {
    try {
      this.db.prepare('UPDATE triggers SET active = 0 WHERE id = ?').run(id);
    } catch (err) {
      throw new StorageError('Failed to remove trigger', err);
    }
  }
}
