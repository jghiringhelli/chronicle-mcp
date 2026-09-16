import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';

/**
 * The MCP surface (ADR-011, ADR-018).
 *
 * 608 lines at 0% coverage before this file, and the place the only logic defect of the whole
 * compliance pass lived: `session(action:'end', project)` ignored `project` and failed on an empty
 * id. `scripts/smoke-mcp.mjs` covers the happy paths against a spawned server, but a spawned process
 * is invisible to coverage and to Stryker — so the handlers were mutated and never killed.
 *
 * These run the REAL server in-process over InMemoryTransport, which means coverage and mutation
 * both count them. The emphasis is deliberately on **error branches**: the smoke test already proves
 * the happy path works, and what it cannot tell us is what happens when an agent calls something
 * wrong, which is most of what an agent does.
 */

const dbHolder: { db: Database.Database | null } = { db: null };
const configHolder: { config: Record<string, unknown> } = { config: {} };

vi.mock('../../../src/shared/config/index.js', () => ({
  getConfig: () => configHolder.config,
  getConfigDir: () => '/tmp/test-chronicle',
  resetConfigCache: () => {},
}));

vi.mock('../../../src/infrastructure/db/database.js', () => ({
  getDatabase: () => dbHolder.db,
  applyConcurrencyPragmas: () => {},
  migrateLocalSchema: () => [],
  closeDatabase: () => {},
}));

/** The repository identity is derived from cwd; pin it so assertions do not depend on the checkout. */
vi.mock('../../../src/shared/repo-identity.js', () => ({
  resolveProject: (explicit?: string) =>
    explicit?.trim()
      ? { id: explicit.trim(), source: 'explicit', root: '/test' }
      : { id: 'github.com/test/fixture', source: 'remote', root: '/test' },
  getProjectIdentity: () => ({ id: 'github.com/test/fixture', source: 'remote', root: '/test' }),
  resolveProjectIdentity: () => ({ id: 'github.com/test/fixture', source: 'remote', root: '/test' }),
  normalizeRemote: (r: string) => r,
  resetProjectIdentityCache: () => {},
}));

/** No network in a unit test: the cloud paths must be unreachable, not merely unconfigured. */
vi.mock('../../../src/services/sync.js', () => ({
  syncMemories: () => Promise.resolve({ pushed: 0, pulled: 0, conflicts: 0, skipped: true }),
  syncInsights: () => Promise.resolve({ pushed: 0, pulled: 0, conflicts: 0, skipped: true }),
  syncCoordination: () => Promise.resolve({ pushed: 0, pulled: 0, conflicts: 0, skipped: true }),
  pushSessionSummary: () => Promise.resolve(),
}));

const { createMcpServer } = await import('../../../src/mcp/server.js');

describe('MCP server surface', () => {
  let client: Client;

  /** Call a tool and parse the JSON payload every handler returns. */
  const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const res = await client.callTool({ name, arguments: args });
    const text = ((res.content ?? []) as Array<{ text?: string }>).map((c) => c.text ?? '').join('');
    return JSON.parse(text) as Record<string, unknown>;
  };

  beforeEach(async () => {
    dbHolder.db = new Database(':memory:');
    dbHolder.db.exec(SCHEMA_SQL);
    configHolder.config = {
      userId: 'test-user',
      deviceId: 'test-device',
      dbPath: ':memory:',
      // No railwayUrl, no teamId, no teamToken — the ordinary single-machine install.
    };

    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    dbHolder.db?.close();
    dbHolder.db = null;
  });

  // ── The surface itself (ADR-011) ──────────────────────────────────────────────────────────

  describe('registered surface', () => {
    it('registers exactly the four action-dispatching tools', async () => {
      const { tools } = await client.listTools();

      expect(tools.map((t) => t.name).sort()).toEqual(['axon', 'chronicle', 'session', 'team']);
    });

    it('gives every tool a description an agent can act on', async () => {
      const { tools } = await client.listTools();

      // The description is the only specification the host reads (ADR-011 §2).
      for (const t of tools) {
        expect(t.description, `${t.name} has no description`).toBeTruthy();
        expect(t.description!.length, `${t.name} description is too thin`).toBeGreaterThan(40);
      }
    });

    it('dispatches chronicle on a closed action enum', async () => {
      const { tools } = await client.listTools();
      const schema = tools.find((t) => t.name === 'chronicle')?.inputSchema as
        { properties?: { action?: { enum?: string[] } } };

      expect(schema.properties?.action?.enum).toContain('remember');
      expect(schema.properties?.action?.enum).toContain('recall');
    });
  });

  // ── remember / recall, including the derived identity (ADR-018) ────────────────────────────

  describe('remember', () => {
    it('derives the project when none is given', async () => {
      const out = await call('chronicle', { action: 'remember', content: 'a fact', memory_type: 'semantic' });

      expect(out['project']).toBe('github.com/test/fixture');
      expect(out['projectSource']).toBe('remote');
      expect(out['scope']).toBe('project');
    });

    it('lets an explicit project win', async () => {
      const out = await call('chronicle', {
        action: 'remember', content: 'a fact', memory_type: 'semantic', project: 'explicit-label',
      });

      expect(out['project']).toBe('explicit-label');
      expect(out['projectSource']).toBe('explicit');
    });

    it('does not pin a person-scoped memory to a project', async () => {
      const out = await call('chronicle', {
        action: 'remember', content: 'I prefer early returns', memory_type: 'semantic', scope: 'person',
      });

      expect(out['scope']).toBe('person');
      expect(out['project']).toBeUndefined();
    });

    it('seeds tier and weight from the type', async () => {
      const semantic = await call('chronicle', { action: 'remember', content: 'x', memory_type: 'semantic' });
      const procedural = await call('chronicle', { action: 'remember', content: 'y', memory_type: 'procedural' });

      expect(semantic['tier']).toBe('working');
      expect(procedural['tier']).toBe('core');
    });

    it('puts a confirmed memory in core with a boosted weight', async () => {
      const out = await call('chronicle', {
        action: 'remember', content: 'permanent', memory_type: 'semantic', confirmed: true,
      });

      expect(out['tier']).toBe('core');
      expect(out['weight']).toBeCloseTo(0.75, 5);
    });

    it('accepts an empty content string rather than crashing', async () => {
      // An agent passing nothing is a real case; the handler defaults rather than throwing.
      const out = await call('chronicle', { action: 'remember' });

      expect(out['id']).toBeTruthy();
    });
  });

  describe('recall', () => {
    beforeEach(async () => {
      await call('chronicle', {
        action: 'remember', content: 'railway does not persist tmp', memory_type: 'semantic',
      });
      await call('chronicle', {
        action: 'remember', content: 'I prefer early returns', memory_type: 'semantic', scope: 'person',
      });
    });

    it('returns project and person scope together by default', async () => {
      const out = await call('chronicle', { action: 'recall', query: 'railway early' }) as unknown as
        Array<{ scope: string }>;

      expect(out.map((m) => m.scope).sort()).toEqual(['person', 'project']);
    });

    it('narrows to one scope when asked', async () => {
      const out = await call('chronicle', { action: 'recall', query: 'railway early', scope: 'person' }) as
        unknown as Array<{ scope: string }>;

      expect(out).toHaveLength(1);
      expect(out[0]?.scope).toBe('person');
    });

    it('returns an empty array for a query that matches nothing', async () => {
      const out = await call('chronicle', { action: 'recall', query: 'xylophone quantum' }) as unknown as [];

      expect(out).toEqual([]);
    });

    it('honours the limit across both scopes', async () => {
      const out = await call('chronicle', { action: 'recall', query: 'railway early', limit: 1 }) as
        unknown as unknown[];

      expect(out).toHaveLength(1);
    });

    it('reinforces what it returns', async () => {
      const first = await call('chronicle', { action: 'recall', query: 'railway' }) as unknown as
        Array<{ id: string; weight: number }>;
      const w1 = first[0]!.weight;
      const second = await call('chronicle', { action: 'recall', query: 'railway' }) as unknown as
        Array<{ weight: number }>;

      expect(second[0]!.weight).toBeGreaterThan(w1);
    });
  });

  describe('forget', () => {
    it('removes a memory', async () => {
      const made = await call('chronicle', { action: 'remember', content: 'temporary', memory_type: 'episodic' });

      await call('chronicle', { action: 'forget', id: made['id'] as string });

      const left = await call('chronicle', { action: 'recall', query: 'temporary' }) as unknown as [];
      expect(left).toEqual([]);
    });

    it('says so rather than succeeding silently for an unknown id', async () => {
      // A delete that quietly does nothing is worse than one that complains: the agent believes it
      // cleaned up, and the memory it meant to remove is still there. `DELETE ... WHERE id = ?`
      // ignored `changes` and the handler always answered "Deleted." — found by this test.
      const out = await call('chronicle', { action: 'forget', id: 'no-such-id' });

      expect(out['deleted']).toBe(false);
      expect(String(out['message'])).toMatch(/no memory|nothing was deleted/i);
    });

    it('distinguishes a real delete from a miss', async () => {
      const made = await call('chronicle', { action: 'remember', content: 'real', memory_type: 'episodic' });

      const hit = await call('chronicle', { action: 'forget', id: made['id'] as string });
      const miss = await call('chronicle', { action: 'forget', id: made['id'] as string });

      expect(hit['deleted']).toBe(true);
      expect(miss['deleted']).toBe(false);
    });
  });

  // ── Error branches: what an agent calling wrongly actually gets ───────────────────────────

  describe('error handling', () => {
    it('rejects an unknown action by naming it', async () => {
      const res = await client.callTool({ name: 'chronicle', arguments: { action: 'teleport' } });
      const text = ((res.content ?? []) as Array<{ text?: string }>).map((c) => c.text ?? '').join('');

      // A silent no-op here is the worst outcome: the agent believes it stored something.
      expect(res.isError === true || /unknown|invalid/i.test(text)).toBe(true);
    });

    it('reports an error for a tool that does not exist', async () => {
      // The SDK answers with `isError: true` rather than rejecting. Either is fine; what matters is
      // that it is not mistaken for a result.
      const res = await client.callTool({ name: 'not-a-tool', arguments: {} });

      expect(res.isError).toBe(true);
    });

    it('answers stats on an empty store instead of dividing by zero', async () => {
      const out = await call('chronicle', { action: 'stats' });

      expect(out['total']).toBe(0);
    });
  });

  // ── Triggers (F2) ─────────────────────────────────────────────────────────────────────────

  describe('triggers', () => {
    it('fires a trigger registered for an action', async () => {
      await call('chronicle', {
        action: 'trigger', trigger_action: 'deploy',
        content: 'redis eviction resets on deploy', severity: 'critical',
      });

      const fired = await call('chronicle', { action: 'check', trigger_action: 'deploy' }) as unknown as
        Array<{ severity: string }>;

      expect(fired).toHaveLength(1);
      expect(fired[0]?.severity).toBe('critical');
    });

    it('returns nothing for an action with no triggers', async () => {
      const fired = await call('chronicle', { action: 'check', trigger_action: 'publish' }) as unknown as [];

      expect(fired).toEqual([]);
    });
  });

  // ── Preferences (F3) ──────────────────────────────────────────────────────────────────────

  describe('preferences', () => {
    it('stores and returns a preference', async () => {
      await call('chronicle', { action: 'pref', pref_key: 'indent', pref_value: 'spaces' });

      const prefs = await call('chronicle', { action: 'prefs' }) as unknown as Array<{ key: string; value: string }>;

      expect(prefs.some((p) => p.key === 'indent' && p.value === 'spaces')).toBe(true);
    });
  });

  // ── Session lifecycle, including the regression (F7) ──────────────────────────────────────

  describe('session', () => {
    it('starts on the derived project when none is given', async () => {
      const out = await call('session', { action: 'start' });

      expect(out['project']).toBe('github.com/test/fixture');
      expect(out['status']).toBe('active');
    });

    it('ends the session started on the derived project — the regression', async () => {
      // THE defect: `start` with no argument opened a session on the derived identity, and `end`
      // with no argument demanded an id the caller never saw, failing with `Session not found: `.
      const started = await call('session', { action: 'start' });

      const ended = await call('session', { action: 'end', summary: 'done' });

      expect(ended['id']).toBe(started['id']);
      expect(ended['status']).toBe('ended');
    });

    it('ends by explicit project too', async () => {
      const started = await call('session', { action: 'start', project: 'proj-a' });

      const ended = await call('session', { action: 'end', project: 'proj-a' });

      expect(ended['id']).toBe(started['id']);
    });

    it('names the project when there is no active session to end', async () => {
      const out = await call('session', { action: 'end', project: 'never-started' });

      expect(String(out['error'])).toMatch(/never-started/);
      expect(out['project']).toBe('never-started');
    });

    it('reports maintenance counts on end', async () => {
      await call('session', { action: 'start' });

      const ended = await call('session', { action: 'end' });

      expect(ended['maintenance']).toBeDefined();
    });

    it('omits the mirror report when no remote is configured', async () => {
      // The single-machine case: absence of railwayUrl is normal, not an error (ADR-010 §3).
      await call('session', { action: 'start' });

      const ended = await call('session', { action: 'end' });

      expect(ended['mirror']).toBeUndefined();
    });

    it('recovers an active session', async () => {
      const started = await call('session', { action: 'start' });

      const recovered = await call('session', { action: 'recover', id: started['id'] as string });

      expect(recovered['id']).toBe(started['id']);
    });

    it('answers rather than throwing when there is nothing to recover', async () => {
      const out = await call('session', { action: 'recover', project: 'nothing-here' });

      expect(out['message'] ?? out['error']).toBeTruthy();
    });
  });

  // ── The licence gate: inert without configuration, never a crash (ADR-010 §3) ─────────────

  describe('team and axon gates', () => {
    it('axon answers with a licence message instead of throwing', async () => {
      const out = await call('axon', { action: 'status', project: 'x' });

      expect(String(out['error'])).toMatch(/licen[cs]e|token/i);
    });

    it('team answers with a licence message instead of throwing', async () => {
      const out = await call('team', { action: 'members' });

      expect(String(out['error'])).toMatch(/licen[cs]e|token|teamId/i);
    });

    it('every axon action is gated, not just status', async () => {
      // A gate that covers one action and not the rest is not a gate. These are real axon actions
      // (the first version of this test used `members`, which belongs to `team`, and got a schema
      // error rather than the gate — the enum is closed, which is itself worth knowing).
      // `session_start` is here because it is the one action a hook fires unattended: if the
      // gate missed it, a machine with no licence would still be registering contributors.
      for (const action of ['queue', 'merges', 'decompose', 'assign', 'session_start']) {
        const out = await call('axon', { action, project: 'x' });
        expect(String(out['error']), `axon ${action} was not gated`).toMatch(/licen[cs]e|token/i);
      }
    });

    it('rejects an action that is not in the closed enum', async () => {
      const res = await client.callTool({ name: 'axon', arguments: { action: 'members', project: 'x' } });

      expect(res.isError).toBe(true);
    });
  });
});
