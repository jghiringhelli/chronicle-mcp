/**
 * SQLite implementation of MemoryRepository.
 */

import type Database from 'better-sqlite3';
import type { MemoryRepository, RecallQuery, MemorySearchResult } from '../../ports/repositories/memory-repository.js';
import type { Memory, CreateMemoryInput } from '../../domain/entities/memory.js';
import { createMemory } from '../../domain/entities/memory.js';
import type { MemoryId, MemoryType, StorageTier, ProjectId, Embedding } from '../../domain/types.js';
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
           created_at, last_accessed_at, project, category, tags, source, embedding, confirmed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          tags = ?, source = ?, embedding = ?, confirmed = ?
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
        memory.id,
      );
    } catch (err) {
      throw new StorageError('Failed to update memory', err);
    }
  }

  delete(id: MemoryId, _reason: string): void {
    try {
      this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
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
