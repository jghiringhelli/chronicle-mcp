/**
 * Timestamp normalisation at the Postgres → SQLite boundary.
 *
 * EDR-003 invariant 4: every timestamp Chronicle stores is an ISO-8601 string produced by
 * `Date.toISOString()`, and the sync conflict policy compares those strings **lexicographically**.
 * That only works because the format is uniform — same length, same `Z` suffix, zero-padded.
 *
 * The pull paths violated it. `postgres.js` maps a `timestamptz` column to a JavaScript **`Date`**,
 * and the pull code cast those columns `as string` — a cast the compiler accepts and reality does
 * not. better-sqlite3 then refused the bind with *"SQLite3 can only bind numbers, strings, bigints,
 * buffers, and null"*, which is how `team sync` failed against the real database while every unit
 * test passed: the tests use a fake `sql` client that hands back strings.
 *
 * So this is not a convenience wrapper. It is the one place that makes invariant 4 true for data
 * arriving from the mirror, and every pull site MUST route timestamps through it.
 */

/**
 * Coerce a value from a Postgres row into the ISO-8601 string Chronicle stores.
 *
 * @param value - A `Date` (what the driver returns for `timestamptz`), an ISO string (what a fake
 *   client or a JSON column returns), epoch milliseconds, or null/undefined
 * @param fallback - Used when the value is absent or unparseable; defaults to now
 * @returns An ISO-8601 string safe to bind to SQLite and to compare lexicographically
 *
 * Never throws: a malformed timestamp on one pulled row must not abort a whole sync pass.
 */
export function toIsoString(value: unknown, fallback: string = new Date().toISOString()): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallback : value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    // Already normalised by a previous pass, or supplied by a test double — keep it as-is so a
    // round trip is stable rather than re-parsed into a different spelling of the same instant.
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
  }
  return fallback;
}

/**
 * Coerce a Postgres value into the JSON-array string Chronicle stores for `tags`.
 *
 * `text[]` comes back as a JavaScript array, which SQLite also cannot bind. The `tags` column is a
 * JSON string with a `'[]'` default and is never NULL (EDR-002 invariant 2).
 *
 * @param value - An array (driver), a JSON string (already normalised), or null/undefined
 * @returns A JSON array string, `'[]'` when there is nothing to store
 */
export function toTagsJson(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(String));
  if (typeof value === 'string' && value.trim().startsWith('[')) return value;
  return '[]';
}
