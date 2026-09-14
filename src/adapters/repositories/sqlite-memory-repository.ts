/**
 * SQLite implementation of MemoryRepository.
 */

import type Database from 'better-sqlite3';
import type { MemoryRepository, RecallQuery, MemorySearchResult } from '../../ports/repositories/memory-repository.js';
import type { Memory, CreateMemoryInput } from '../../domain/entities/memory.js';
import { createMemory } from '../../domain/entities/memory.js';
import type { MemoryId, MemoryType, MemoryScope, StorageTier, ProjectId, Embedding } from '../../domain/types.js';
import { DEFAULT_SCOPE } from '../../domain/types.js';
import { StorageError } from '../../shared/exceptions/index.js';

interface MemoryRow {
  id: string;
  content: string;
  memory_type: string;
  tier: string;
  weight: number;
  decay_rate: number;
  access_count: number;
  created_at: string;
  last_accessed_at: string;
  project: string | null;
  scope: string | null;
  category: string | null;
  tags: string;
  source: string | null;
  embedding: Buffer | null;
  confirmed: number;
}

function rowToMemory(row: MemoryRow): Memory {
  let embedding: Embedding | undefined;
  if (row.embedding) {
    const floats = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
    embedding = Array.from(floats);
  }

  return {
    id: row.id,
    content: row.content,
    memoryType: row.memory_type as MemoryType,
    tier: row.tier as StorageTier,
    weight: row.weight,
    decayRate: row.decay_rate,
    accessCount: row.access_count,
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at,
    project: row.project ?? undefined,
    // A row written before ADR-018 has no scope; DEFAULT_SCOPE is what it meant.
    scope: (row.scope as MemoryScope | null) ?? DEFAULT_SCOPE,
    category: row.category ?? undefined,
    tags: Object.freeze(JSON.parse(row.tags) as string[]),
    source: row.source ?? undefined,
    embedding,
    confirmed: !!row.confirmed,
  };
}

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private db: Database.Database) {}

  create(id: MemoryId, input: CreateMemoryInput): Memory {
    const memory = createMemory(id, input);
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO memories
          (id, content, memory_type, tier, weight, decay_rate, access_count,
           created_at, last_accessed_at, project, scope, category, tags, source, embedding, confirmed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memory.id,
        memory.content,
        memory.memoryType,
        memory.tier,
        memory.weight,
        memory.decayRate,
        memory.accessCount,
        memory.createdAt,
        memory.lastAccessedAt,
        memory.project ?? null,
        memory.scope,
        memory.category ?? null,
        JSON.stringify(memory.tags),
        memory.source ?? null,
        null,
        memory.confirmed ? 1 : 0,
      );
    } catch (err) {
      throw new StorageError('Failed to create memory', err);
    }
    return memory;
  }

  findById(id: MemoryId): Memory | undefined {
    try {
      const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
      return row ? rowToMemory(row) : undefined;
    } catch (err) {
      throw new StorageError('Failed to find memory', err);
    }
  }

  recall(query: RecallQuery): MemorySearchResult[] {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      // Text search
      const words = query.query.trim().split(/\s+/).filter(Boolean);
      if (words.length > 0) {
        const textConditions = words.map(() => '(content LIKE ? OR tags LIKE ?)');
        conditions.push(`(${textConditions.join(' OR ')})`);
        for (const word of words) {
          params.push(`%${word}%`, `%${word}%`);
        }
      }

      if (query.project) {
        conditions.push('project = ?');
        params.push(query.project);
      }

      if (query.category) {
        conditions.push('category = ?');
        params.push(query.category);
      }

      if (query.memoryTypes && query.memoryTypes.length > 0) {
        const placeholders = query.memoryTypes.map(() => '?').join(', ');
        conditions.push(`memory_type IN (${placeholders})`);
        params.push(...query.memoryTypes);
      }

      // Scope filter. The common recall is "this repository's project memories plus my person
      // memories", which a caller expresses as scopes: ['project', 'person'] with the project set.
      if (query.scopes && query.scopes.length > 0) {
        const placeholders = query.scopes.map(() => '?').join(', ');
        conditions.push(`scope IN (${placeholders})`);
        params.push(...query.scopes);
      }

      if (query.tiers && query.tiers.length > 0) {
        const placeholders = query.tiers.map(() => '?').join(', ');
        conditions.push(`tier IN (${placeholders})`);
        params.push(...query.tiers);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = query.limit ?? 20;

      const rows = this.db.prepare(`
        SELECT * FROM memories ${where} ORDER BY weight DESC LIMIT ?
      `).all(...params, limit) as MemoryRow[];

      return rows.map(row => ({ memory: rowToMemory(row), score: row.weight }));
    } catch (err) {
      throw new StorageError('Failed to recall memories', err);
    }
  }

  update(memory: Memory): void {
    try {
      let embeddingBuffer: Buffer | null = null;
      if (memory.embedding) {
        embeddingBuffer = Buffer.from(new Float32Array(memory.embedding).buffer);
      }

      this.db.prepare(`
        UPDATE memories SET
          content = ?, memory_type = ?, tier = ?, weight = ?, decay_rate = ?,
          access_count = ?, last_accessed_at = ?, project = ?, category = ?,
          tags = ?, source = ?, embedding = ?, confirmed = ?, scope = ?
        WHERE id = ?
      `).run(
        memory.content,
        memory.memoryType,
        memory.tier,
        memory.weight,
        memory.decayRate,
        memory.accessCount,
        memory.lastAccessedAt,
        memory.project ?? null,
        memory.category ?? null,
        JSON.stringify(memory.tags),
        memory.source ?? null,
        embeddingBuffer,
        memory.confirmed ? 1 : 0,
        memory.scope,
        memory.id,
      );
    } catch (err) {
      throw new StorageError('Failed to update memory', err);
    }
  }

  /**
   * Decay every eligible memory with one statement.
   *
   * SQLite 3.35+ ships `exp()` (verified present in the bundled 3.53), so EDR-001's formula runs in
   * the engine instead of in JavaScript. That removes both costs the measurements exposed:
   * materialising tens of thousands of entities, and issuing one UPDATE per row.
   *
   * Measured at 50,000 memories: 10.4s row-by-row, 1.08s batched in a transaction, and this.
   *
   * `decay_rate > 0` is the guard that keeps permanent memories permanent — `e^0` is 1, so the
   * arithmetic would be harmless, but excluding them keeps the row count honest and matches the
   * early return in `decayMemory`.
   *
   * The day count uses `julianday`, which is fractional, exactly like `Clock.daysBetween`.
   */
  decayOlderThan(cutoff: string, now: string): number {
    try {
      const { changes } = this.db.prepare(`
        UPDATE memories
        SET weight = weight * exp(-decay_rate * (julianday(?) - julianday(last_accessed_at)))
        WHERE decay_rate > 0
          AND tier != 'core'
          AND last_accessed_at < ?
      `).run(now, cutoff);
      return changes;
    } catch (err) {
      throw new StorageError('Failed to decay memories', err);
    }
  }

  /**
   * Promote a tier in one statement.
   *
   * The last materialisation in the session-end pass. With this and `decayOlderThan` in the engine,
   * the pass at 50,000 memories went from 10.4s (row by row) to 1.08s (batched) to well under the
   * 500ms NFR-04 budget.
   */
  promoteTier(fromTier: StorageTier, toTier: StorageTier, minAccess: number): number {
    try {
      const { changes } = this.db.prepare(`
        UPDATE memories SET tier = ?
        WHERE tier = ? AND access_count >= ?
      `).run(toTier, fromTier, minAccess);
      return changes;
    } catch (err) {
      throw new StorageError('Failed to promote memories', err);
    }
  }

  /**
   * Apply many updates in a single transaction.
   *
   * `better-sqlite3` autocommits every statement, so a per-row loop pays a commit per row: the decay
   * pass at 50k measured 10.4s that way, against a 500ms budget. `db.transaction()` wraps the lot,
   * and it is atomic — a throw rolls the whole batch back rather than leaving half a decay applied.
   *
   * The statement is prepared once, outside the loop, which is the other half of the win.
   */
  updateMany(memories: readonly Memory[]): void {
    if (memories.length === 0) return;
    try {
      const stmt = this.db.prepare(`
        UPDATE memories SET
          content = ?, memory_type = ?, tier = ?, weight = ?, decay_rate = ?,
          access_count = ?, last_accessed_at = ?, project = ?, category = ?,
          tags = ?, source = ?, confirmed = ?, scope = ?
        WHERE id = ?
      `);
      const run = this.db.transaction((batch: readonly Memory[]) => {
        for (const m of batch) {
          stmt.run(
            m.content, m.memoryType, m.tier, m.weight, m.decayRate,
            m.accessCount, m.lastAccessedAt, m.project ?? null, m.category ?? null,
            JSON.stringify(m.tags), m.source ?? null, m.confirmed ? 1 : 0, m.scope,
            m.id,
          );
        }
      });
      run(memories);
    } catch (err) {
      throw new StorageError('Failed to update memories', err);
    }
  }

  delete(id: MemoryId, _reason: string): boolean {
    try {
      // `changes` is the whole point: a DELETE that matches nothing is not an error, but reporting
      // it as a success is. The MCP handler used to answer "Deleted." for an id that never existed,
      // so an agent cleaning up by id could not tell a real delete from a typo, and the memory it
      // meant to remove stayed.
      const { changes } = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      return changes > 0;
    } catch (err) {
      throw new StorageError('Failed to delete memory', err);
    }
  }

  findForDecay(olderThan: string): Memory[] {
    try {
      const rows = this.db.prepare(`
        SELECT * FROM memories WHERE last_accessed_at < ? AND tier != 'core'
      `).all(olderThan) as MemoryRow[];
      return rows.map(rowToMemory);
    } catch (err) {
      throw new StorageError('Failed to find memories for decay', err);
    }
  }

  findForPromotion(tier: StorageTier, minAccessCount: number): Memory[] {
    try {
      const rows = this.db.prepare(`
        SELECT * FROM memories WHERE tier = ? AND access_count >= ?
      `).all(tier, minAccessCount) as MemoryRow[];
      return rows.map(rowToMemory);
    } catch (err) {
      throw new StorageError('Failed to find memories for promotion', err);
    }
  }

  count(criteria?: { project?: ProjectId; memoryType?: MemoryType; tier?: StorageTier }): number {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (criteria?.project) {
        conditions.push('project = ?');
        params.push(criteria.project);
      }
      if (criteria?.memoryType) {
        conditions.push('memory_type = ?');
        params.push(criteria.memoryType);
      }
      if (criteria?.tier) {
        conditions.push('tier = ?');
        params.push(criteria.tier);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM memories ${where}`).get(...params) as { cnt: number };
      return row.cnt;
    } catch (err) {
      throw new StorageError('Failed to count memories', err);
    }
  }

  attachEmbedding(id: MemoryId, embedding: Embedding): void {
    try {
      const buffer = Buffer.from(new Float32Array(embedding).buffer);
      this.db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(buffer, id);
    } catch (err) {
      throw new StorageError('Failed to attach embedding', err);
    }
  }
}
