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
export { getDatabase } from './infrastructure/db/database.js';
export { NodeIdGenerator } from './infrastructure/gateways/node-id-generator.js';
