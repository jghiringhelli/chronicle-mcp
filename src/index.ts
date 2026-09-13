/**
 * Chronicle public API.
 */

export * from './domain/index.js';
export { createMcpServer } from './mcp/server.js';
export { getConfig, loadConfig, getConfigDir, resetConfigCache } from './shared/config/index.js';
export {
  resolveProjectIdentity, resolveProject, getProjectIdentity, normalizeRemote,
  resetProjectIdentityCache,
} from './shared/repo-identity.js';
export type { ProjectIdentity, ProjectIdSource } from './shared/repo-identity.js';
export { toIsoString, toTagsJson } from './shared/time.js';
export * from './shared/exceptions/index.js';
export * from './ports/repositories/index.js';
export * from './ports/gateways/index.js';
export { getDatabase, migrateLocalSchema, applyConcurrencyPragmas } from './infrastructure/db/database.js';
// Exported so tooling that builds a store outside the server — the NFR benchmark, a fixture — uses
// the SAME schema the server does, rather than a copy that drifts.
export { SCHEMA_SQL, SCHEMA_TABLES_SQL, SCHEMA_INDEXES_SQL } from './infrastructure/db/schema.js';
export { NodeIdGenerator } from './infrastructure/gateways/node-id-generator.js';
