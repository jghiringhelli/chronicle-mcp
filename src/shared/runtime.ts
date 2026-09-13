/**
 * The minimum Node version this package can actually run on, and the check that enforces it.
 *
 * This exists because of a specific failure: `better-sqlite3@13` requires Node >= 22, `package.json`
 * claimed `>= 20`, and on Node 20 the native binding did not fail to load — it **segfaulted**.
 * Exit 139, `Segmentation fault (core dumped)`, no stack, no message, nothing to search for. For a
 * tool whose entire value is not losing what you wrote down, that is the worst available failure
 * mode, and `engines.node` alone does not prevent it: npm and pnpm treat an engine mismatch as a
 * warning by default, and `npx`, a global install or a vendored copy can skip the check entirely.
 *
 * So the runtime states its own requirement, in a module with no imports — it must be evaluable
 * before anything native is loaded.
 */

/**
 * Kept in step with `engines.node` by `tests/unit/shared/runtime.test.ts`, which reads
 * `package.json` and the CI matrix and fails if any of the three disagree. Raising the floor means
 * changing this constant, `engines.node`, and the low end of the matrix together.
 */
export const MINIMUM_NODE_MAJOR = 22;

/** Why this floor is where it is, printed to the user rather than kept in a comment. */
export const MINIMUM_NODE_REASON =
  'better-sqlite3@13 declares engines.node ">=22"; on Node 20 its prebuilt binding segfaults ' +
  'rather than reporting an error (ADR-022)';

export interface RuntimeCheck {
  readonly ok: boolean;
  readonly major: number;
  /** Present only when `ok` is false. Written for someone reading a terminal, not a log parser. */
  readonly message?: string;
}

/**
 * Is this Node new enough? Pure, and takes the version as an argument so it is testable without
 * spawning a different Node.
 *
 * An unparseable version is treated as acceptable. A version string this does not understand is
 * more likely to be a future format or an exotic build than a genuinely old runtime, and refusing
 * to start on a string we failed to parse would be a worse bug than the one being prevented.
 */
export function checkRuntime(version: string = process.versions.node): RuntimeCheck {
  const major = Number(/^v?(\d+)/.exec(version)?.[1]);

  if (!Number.isFinite(major)) return { ok: true, major: NaN };
  if (major >= MINIMUM_NODE_MAJOR) return { ok: true, major };

  return {
    ok: false,
    major,
    message:
      `Chronicle requires Node ${MINIMUM_NODE_MAJOR} or newer, but this is Node ${version}.\n` +
      `  Reason: ${MINIMUM_NODE_REASON}.\n` +
      `  Without this check the process would crash with a segmentation fault and no message.\n` +
      `  Upgrade Node, or point your MCP client at a Node ${MINIMUM_NODE_MAJOR}+ binary.`,
  };
}

/** The same check, as an assertion, for embedders using Chronicle as a library. */
export function assertSupportedRuntime(version: string = process.versions.node): void {
  const result = checkRuntime(version);
  if (!result.ok) throw new Error(result.message);
}
