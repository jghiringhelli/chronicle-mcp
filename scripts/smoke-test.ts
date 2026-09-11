/**
 * End-to-end smoke test: spawn the built chronicle MCP server and exercise it
 * as a real MCP client would. Uses the live ~/.chronicle/config.json (local
 * SQLite + the configured Railway DB + team token).
 *
 * Writes one local memory and deletes it; team/axon checks are read-only or
 * idempotent. Usage: npx tsx scripts/smoke-test.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type ToolResult = { content?: Array<{ text?: string }> };

function parse(res: unknown): unknown {
  const text = (res as ToolResult).content?.[0]?.text;
  if (text == null) return res;
  try { return JSON.parse(text); } catch { return text; }
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/cli.js'],
  env: process.env as Record<string, string>,
});
const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { capabilities: {} });

await client.connect(transport);

const tools = (await client.listTools()).tools.map(t => t.name);
console.log('TOOLS:', tools.join(', '));

// ── chronicle: local memory write → read → cleanup ──────────────────────────
const rem = parse(await client.callTool({ name: 'chronicle', arguments: {
  action: 'remember', content: 'SMOKE-TEST: prefer pnpm in this repo',
  memory_type: 'procedural', project: 'smoke-test',
} })) as { id?: string };
console.log('chronicle.remember:', rem);

const rec = parse(await client.callTool({ name: 'chronicle', arguments: {
  action: 'recall', query: 'pnpm', project: 'smoke-test',
} }));
console.log('chronicle.recall:', Array.isArray(rec) ? `${rec.length} hit(s)` : rec);

if (rem.id) {
  console.log('chronicle.forget:', parse(await client.callTool({ name: 'chronicle', arguments: { action: 'forget', id: rem.id } })));
}

// ── team: Railway + token validation (read-only / idempotent) ───────────────
console.log('team.members:', parse(await client.callTool({ name: 'team', arguments: { action: 'members' } })));
console.log('team.sync:', parse(await client.callTool({ name: 'team', arguments: { action: 'sync' } })));

// ── axon: coordination tool reachable under the same token ──────────────────
console.log('axon.status:', parse(await client.callTool({ name: 'axon', arguments: { action: 'status', project: 'smoke-test' } })));

await client.close();
console.log('\nSMOKE TEST COMPLETE');
