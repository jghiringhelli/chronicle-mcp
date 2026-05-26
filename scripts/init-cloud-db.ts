/**
 * Apply Chronicle's cloud schema to a fresh Railway Postgres.
 *
 * Applies BOTH the individual sync schema (cloud-schema.sql — users, memories,
 * insights, session_summaries, sync_cursor) and the team schema (TEAM_SCHEMA_SQL).
 * Idempotent (CREATE TABLE IF NOT EXISTS). Run once per new database.
 *
 * Usage:
 *   DB_URL="postgresql://..." npx tsx scripts/init-cloud-db.ts
 */

import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TEAM_SCHEMA_SQL } from '../src/infrastructure/db/team-schema.js';

const url = process.env['DB_URL'];
if (!url) {
  console.error('DB_URL env var is required.');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const cloudSchema = readFileSync(join(here, '..', 'src', 'infrastructure', 'db', 'cloud-schema.sql'), 'utf-8');

const sql = postgres(url, { ssl: 'require', max: 1 });
try {
  await sql.unsafe(cloudSchema);
  await sql.unsafe(TEAM_SCHEMA_SQL);
  const tables = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `;
  console.log(`Applied schema. ${tables.length} tables:`);
  console.log(tables.map(t => t.tablename).join(', '));
} finally {
  await sql.end();
}
