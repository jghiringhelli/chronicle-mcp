import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkRuntime, assertSupportedRuntime, MINIMUM_NODE_MAJOR,
} from '../../../src/shared/runtime.js';

/**
 * The supported-Node floor, and the three places it is written down.
 *
 * On 2026-09-12 the CI matrix caught `engines.node: ">=20"` against a dependency requiring `>=22`.
 * The symptom on Node 20 was `Segmentation fault (core dumped)` — exit 139, no stack, no message.
 * The number now lives in three files that must agree, so the parity tests below are the point of
 * this file; the unit tests around them are the cheap part.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..');

describe('the supported Node floor agrees everywhere it is written', () => {
  it('matches engines.node in package.json', () => {
    const declared = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines?.node;
    const floor = Number(/(\d+)/.exec(String(declared))?.[1]);

    expect(
      floor,
      `package.json engines.node is "${declared}" but MINIMUM_NODE_MAJOR is ${MINIMUM_NODE_MAJOR}. ` +
      'An installer reads engines; the running process reads the constant. They must be the same number.',
    ).toBe(MINIMUM_NODE_MAJOR);
  });

  it('is the lowest version the CI matrix actually runs', () => {
    // A matrix that skips the floor is not testing the claim — which is exactly how ">=20" survived
    // until the day the matrix included 20.
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const line = /node:\s*\[([^\]]+)\]/.exec(ci)?.[1];

    expect(line, 'could not find the Node matrix in .github/workflows/ci.yml').toBeDefined();

    const majors = line!.split(',').map((v) => Number(v.replace(/['"\s]/g, '')));

    expect(
      Math.min(...majors),
      `the CI matrix is [${majors.join(', ')}] but the supported floor is ${MINIMUM_NODE_MAJOR}. ` +
      'Add the floor to the matrix, or raise the floor to what is tested.',
    ).toBe(MINIMUM_NODE_MAJOR);
  });

  it('is at or above every runtime dependency floor', () => {
    // The same property `scripts/check-dependency-policy.mjs` rule 9 gates, asserted here too so a
    // developer sees it from `pnpm test` without having to remember a separate script.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    for (const name of Object.keys(pkg.dependencies ?? {})) {
      let declared: string | undefined;
      try {
        declared = JSON.parse(
          readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8'),
        ).engines?.node;
      } catch {
        continue;
      }
      if (!declared) continue;

      const floors = declared.split('||')
        .map((part) => Number(/(\d+)/.exec(part.trim())?.[1]))
        .filter((n) => Number.isFinite(n));
      if (floors.length === 0) continue;

      expect(
        Math.min(...floors),
        `"${name}" declares engines.node "${declared}", above this package's floor of ${MINIMUM_NODE_MAJOR}`,
      ).toBeLessThanOrEqual(MINIMUM_NODE_MAJOR);
    }
  });
});

describe('the guard runs before anything native is loaded', () => {
  // This is the property that makes the guard work at all, and it is not observable from behaviour
  // on a supported Node — only from the shape of the entry point. On Node 20 the `better-sqlite3`
  // load is a segmentation fault, so a guard evaluated after it never runs and the user sees exit
  // 139 with no message.
  const cli = readFileSync(join(ROOT, 'src', 'cli.ts'), 'utf8');

  it('imports the guard before any other module', () => {
    const imports = [...cli.matchAll(/^import\s.*$/gm)].map((m) => m[0]);

    expect(imports.length, 'cli.ts has no static imports at all').toBeGreaterThan(0);
    expect(
      imports[0],
      `the first static import in cli.ts is ${imports[0]} — the runtime guard must come first`,
    ).toContain('assert-runtime');
  });

  it('reaches the native-loading module through a dynamic import, not a static one', () => {
    // The real guarantee. A static `import { createMcpServer } from './mcp/server.js'` would depend
    // on declaration order surviving every reformat and import sorter; a dynamic import cannot be
    // hoisted above the guard by anything.
    const staticImports = [...cli.matchAll(/^import\s.*$/gm)].map((m) => m[0]);

    expect(
      staticImports.some((line) => line.includes('mcp/server')),
      'cli.ts statically imports ./mcp/server.js, which transitively loads better-sqlite3. ' +
      'Use `await import()` so the guard is guaranteed to have run first.',
    ).toBe(false);

    expect(cli).toMatch(/await import\(['"]\.\/mcp\/server\.js['"]\)/);
  });

  it('writes its diagnostic to stderr, because stdout is the MCP transport', () => {
    // A message on stdout would be read as a malformed protocol frame and the client would report
    // something unrelated to the real problem.
    const guard = readFileSync(join(ROOT, 'src', 'shared', 'assert-runtime.ts'), 'utf8');

    expect(guard).toContain('process.stderr.write');
    expect(guard).not.toMatch(/console\.(log|info)\(/);
  });
});

describe('checkRuntime', () => {
  it('accepts the Node actually running this test', () => {
    const result = checkRuntime();

    expect(result.ok).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('accepts the floor exactly', () => {
    expect(checkRuntime(`${MINIMUM_NODE_MAJOR}.0.0`).ok).toBe(true);
  });

  it('accepts anything above the floor', () => {
    expect(checkRuntime(`${MINIMUM_NODE_MAJOR + 6}.1.2`).ok).toBe(true);
  });

  it('rejects the major below the floor', () => {
    const result = checkRuntime(`${MINIMUM_NODE_MAJOR - 1}.19.4`);

    expect(result.ok).toBe(false);
    expect(result.major).toBe(MINIMUM_NODE_MAJOR - 1);
  });

  it('rejects the version that actually segfaulted, and says why', () => {
    const result = checkRuntime('20.19.4');

    expect(result.ok).toBe(false);
    // The message has to be enough on its own: whoever sees it is looking at a crash, not at ADRs.
    expect(result.message).toContain('Node 22 or newer');
    expect(result.message).toContain('20.19.4');
    expect(result.message).toContain('better-sqlite3');
    expect(result.message).toContain('segmentation fault');
  });

  it('tolerates a leading v', () => {
    expect(checkRuntime('v18.0.0').ok).toBe(false);
    expect(checkRuntime(`v${MINIMUM_NODE_MAJOR}.0.0`).ok).toBe(true);
  });

  it('allows a version string it cannot parse, rather than refusing to start', () => {
    // Refusing to run because we failed to parse a version would be a worse defect than the one
    // this guard prevents. An unrecognised format is far more likely to be newer than older.
    for (const weird of ['', 'not-a-version', 'next', '????']) {
      expect(checkRuntime(weird).ok, `rejected ${JSON.stringify(weird)}`).toBe(true);
    }
  });
});

describe('assertSupportedRuntime', () => {
  it('is silent on a supported runtime', () => {
    expect(() => assertSupportedRuntime()).not.toThrow();
  });

  it('throws with the same message the CLI prints', () => {
    expect(() => assertSupportedRuntime('20.19.4')).toThrow(/Node 22 or newer/);
  });
});
