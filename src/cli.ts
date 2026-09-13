#!/usr/bin/env node
/**
 * Chronicle MCP server CLI entry point.
 *
 * Usage:
 *   chronicle-mcp                          — stdio mode (default)
 *   chronicle-mcp --http                   — HTTP MCP mode on port 3000
 *   chronicle-mcp --http --port 8080
 *   chronicle-mcp --dashboard              — Axon coordination dashboard on port 4321
 *   chronicle-mcp --dashboard --dash-port 4000
 */

// ADR-022. This import must be evaluated before anything that loads the SQLite binding, because on
// an unsupported Node that load is a *segmentation fault*, not an error — a guard placed after it
// never runs. `assert-runtime.js` pulls in nothing native, so it is safe this high up.
import './shared/assert-runtime.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// `createMcpServer` is reached through a DYNAMIC import, and that is the load-bearing part of the
// guard rather than the comment above. It transitively imports `better-sqlite3`; as a static import
// its evaluation order relative to the guard would depend on declaration order surviving every
// future reformat, import sorter and bundler. As a dynamic import, the ordering is guaranteed by the
// language: the module is not fetched until this line runs, and on an unsupported runtime the guard
// has already exited the process.
const { createMcpServer } = await import('./mcp/server.js');

const args = process.argv.slice(2);

// ── generate-token ────────────────────────────────────────────────────────────
// Usage: chronicle-mcp generate-token --team <slug> [--created-by <userId>]
if (args[0] === 'generate-token') {
  const teamIndex = args.indexOf('--team');
  const teamSlug = teamIndex !== -1 ? args[teamIndex + 1] : undefined;
  if (!teamSlug) {
    console.error('Usage: chronicle-mcp generate-token --team <slug>');
    process.exit(1);
  }

  const { getConfig } = await import('./shared/config/index.js');
  const { TeamService } = await import('./services/team-service.js');

  const config = getConfig();
  if (!config.railwayUrl) {
    console.error('railwayUrl is required in ~/.chronicle/config.json to generate tokens.');
    process.exit(1);
  }

  const teamSvc = new TeamService();
  const { token } = await teamSvc.mintToken(teamSlug);
  // The token issuer owns the team: they can curate insights and assign roles.
  await teamSvc.assignRole(teamSlug, config.userId, 'owner');

  console.log(`\nChronicle Team token generated for team: ${teamSlug}\n`);
  console.log(`  token: ${token}\n`);
  console.log(`Add to ~/.chronicle/config.json:`);
  console.log(JSON.stringify({ teamId: teamSlug, teamToken: token }, null, 2));
  process.exit(0);
}

const dashIndex = args.indexOf('--dashboard');

if (dashIndex !== -1) {
  const dashPortIndex = args.indexOf('--dash-port');
  const dashPortArg = dashPortIndex !== -1 ? args[dashPortIndex + 1] : undefined;
  const dashPort = dashPortArg !== undefined ? parseInt(dashPortArg, 10) : 4321;
  const { startDashboard } = await import('./dashboard/server.js');
  startDashboard(dashPort);
  // If --http is also present, fall through to start the MCP server too.
  // Otherwise exit after dashboard starts (dashboard is the process).
  if (!args.includes('--http')) process.stdin.resume(); // keep alive
}

const httpIndex = args.indexOf('--http');
const server = createMcpServer();

if (httpIndex !== -1) {
  const portIndex = args.indexOf('--port');
  const portArg = portIndex !== -1 ? args[portIndex + 1] : undefined;
  const port = portArg !== undefined ? parseInt(portArg, 10) : 3000;

  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { default: http } = await import('node:http');
  const { randomUUID } = await import('node:crypto');

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const httpServer = http.createServer((req, res) => {
    transport.handleRequest(req, res).catch((err: unknown) => {
      console.error('Request error', err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  await server.connect(transport);
  httpServer.listen(port, () => {
    console.error(`Chronicle MCP server listening on port ${port}`);
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
