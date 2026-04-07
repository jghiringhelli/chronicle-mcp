/**
 * SQLite implementation of PreferenceRepository.
 *
 * Note: The preferences table has no created_at column.
 * updated_at is used for both createdAt and updatedAt on the entity.
 */

import type Database from 'better-sqlite3';
import type { PreferenceRepository } from '../../ports/repositories/preference-repository.js';
import type { Preference, SetPreferenceInput } from '../../domain/entities/preference.js';
import type { PreferenceStrength } from '../../domain/entities/preference.js';
import type { MemoryId, ProjectId } from '../../domain/types.js';
import { StorageError } from '../../shared/exceptions/index.js';

interface PreferenceRow {
  id: string;
  key: string;
  value: string;
  context: string | null;
  strength: string;
  project: string | null;
  updated_at: string;
}

function rowToPreference(row: PreferenceRow): Preference {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    context: row.context ?? undefined,
    strength: row.strength as PreferenceStrength,
    project: row.project ?? undefined,
    createdAt: row.updated_at,
    updatedAt: row.updated_at,
  };
}

export class SqlitePreferenceRepository implements PreferenceRepository {
  constructor(private db: Database.Database) {}

  set(id: MemoryId, input: SetPreferenceInput): Preference {
    const now = new Date().toISOString();
    try {
      // Check if a preference with this key+project already exists to preserve id
      const existing = this.db.prepare(
        'SELECT id FROM preferences WHERE key = ? AND (project = ? OR (project IS NULL AND ? IS NULL))',
      ).get(input.key, input.project ?? null, input.project ?? null) as { id: string } | undefined;

      const useId = existing ? existing.id : id;

      this.db.prepare(`
        INSERT INTO preferences (id, key, value, context, strength, project, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key, project) DO UPDATE SET
          value = excluded.value,
          context = excluded.context,
          strength = excluded.strength,
          updated_at = excluded.updated_at
      `).run(
        useId,
        input.key,
        input.value,
        input.context ?? null,
        input.strength ?? 'moderate',
        input.project ?? null,
        now,
      );

      const row = this.db.prepare('SELECT * FROM preferences WHERE id = ?').get(useId) as PreferenceRow;
      return rowToPreference(row);
    } catch (err) {
      throw new StorageError('Failed to set preference', err);
    }
  }

  findByKey(key: string, project?: ProjectId): Preference | undefined {
    try {
      const row = this.db.prepare(
        'SELECT * FROM preferences WHERE key = ? AND (project = ? OR (project IS NULL AND ? IS NULL))',
      ).get(key, project ?? null, project ?? null) as PreferenceRow | undefined;
      return row ? rowToPreference(row) : undefined;
    } catch (err) {
      throw new StorageError('Failed to find preference', err);
    }
  }

  getForContext(context?: string, project?: ProjectId): Preference[] {
    try {
      const conditions: string[] = ['(project IS NULL'];
      const params: unknown[] = [];

      if (project) {
        conditions[0] += ` OR project = ?`;
        params.push(project);
      }
      conditions[0] += ')';

      if (context) {
        conditions.push('(context IS NULL OR context LIKE ?)');
        params.push(`%${context}%`);
      }

      const where = `WHERE ${conditions.join(' AND ')}`;
      const rows = this.db.prepare(`SELECT * FROM preferences ${where} ORDER BY key`).all(...params) as PreferenceRow[];
      return rows.map(rowToPreference);
    } catch (err) {
      throw new StorageError('Failed to get preferences for context', err);
    }
  }

  getGlobal(): Preference[] {
    try {
      const rows = this.db.prepare('SELECT * FROM preferences WHERE project IS NULL ORDER BY key').all() as PreferenceRow[];
      return rows.map(rowToPreference);
    } catch (err) {
      throw new StorageError('Failed to get global preferences', err);
    }
  }

  getByProject(project: ProjectId): Preference[] {
    try {
      const rows = this.db.prepare('SELECT * FROM preferences WHERE project = ? ORDER BY key').all(project) as PreferenceRow[];
      return rows.map(rowToPreference);
    } catch (err) {
      throw new StorageError('Failed to get project preferences', err);
    }
  }

  delete(key: string, project?: ProjectId): void {
    try {
      this.db.prepare(
        'DELETE FROM preferences WHERE key = ? AND (project = ? OR (project IS NULL AND ? IS NULL))',
      ).run(key, project ?? null, project ?? null);
    } catch (err) {
      throw new StorageError('Failed to delete preference', err);
    }
  }
}
