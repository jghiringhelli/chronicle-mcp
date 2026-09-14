/**
 * Side-effect guard for the executable entry points.
 *
 * Imported **first** in `cli.ts`, and the position is load-bearing: ES module imports are evaluated
 * in declaration order, and the crash this prevents happens while `better-sqlite3` is being loaded.
 * A check written in the body of `cli.ts` would run after that import had already segfaulted the
 * process. Keep this import above the others, and keep this module free of imports of its own.
 *
 * Separate from `runtime.ts` because exiting the process is right for a CLI and wrong for a library:
 * an embedder gets `assertSupportedRuntime()` and decides for itself.
 */
import { checkRuntime } from './runtime.js';

const result = checkRuntime();
if (!result.ok) {
  // stderr, because stdout is the MCP stdio transport — a diagnostic written there would be parsed
  // as a malformed protocol frame and the client would report something unrelated.
  process.stderr.write(`\n${result.message}\n\n`);
  process.exit(1);
}
