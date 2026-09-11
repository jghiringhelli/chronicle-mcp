/**
 * Repository identity — what `project` scope is keyed on (ADR-018 §2).
 *
 * `project` used to be whatever string the calling agent passed, so one repository was remembered as
 * `chronicle`, `chronicle-mcp` and `Chronicle` depending on what the model guessed that session.
 * That is drift inside the tool built to prevent it, and it makes project-scope recall fail to join
 * across machines — which is the whole point of the scope.
 *
 * The id is derived, in a fixed order, and carries how it was derived so a reader can tell a stable
 * id from a fallback:
 *
 *   1. `remote`      — `host/owner/repo` from remote.origin.url. Stable across clones, directory
 *                      names, OSes and protocols. Present for 24 of the 25 repositories measured
 *                      when this was written.
 *   2. `root-commit` — `repo:<sha12>` of the first commit. Immutable, survives renames and remote
 *                      changes; unreadable, which is why it is second.
 *   3. `directory`   — `dir:<basename>`, only when this is not a git repository. Prefixed because it
 *                      is the unstable case and that should be visible.
 *
 * Why not the directory name first: measured, `mcp/chronicle` lives in a directory called
 * `chronicle` with the remote `chronicle-mcp`, and `mcp/CodeSeeker` is capitalised while its remote
 * is lowercase. A directory-derived id would not join the same repository across two machines that
 * cloned it under different names.
 */

import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

/** How a project id was established. `explicit` means a caller supplied it. */
export type ProjectIdSource = 'remote' | 'root-commit' | 'directory' | 'explicit';

export interface ProjectIdentity {
  /** The stable key for project scope, e.g. `github.com/jghiringhelli/chronicle-mcp`. */
  readonly id: string;
  /** Which rule produced it. Anything but `remote` is a fallback worth noticing. */
  readonly source: ProjectIdSource;
  /** Absolute path the identity was resolved from, for diagnostics. */
  readonly root: string;
}

/**
 * Reduce a git remote URL to `host/owner/repo`.
 *
 * Handles every form these repositories actually use, plus credentials, which MUST be stripped —
 * a remote can carry a token and a project id is stored and logged.
 *
 * @param remote - Raw value of remote.origin.url
 * @returns The normalised identity, or '' when the input is not usable
 */
export function normalizeRemote(remote: string): string {
  const trimmed = remote.trim();
  if (!trimmed) return '';

  const s = trimmed
    // scp-like form: git@github.com:owner/repo
    .replace(/^[^@/]+@([^:/]+):/, '$1/')
    // any scheme
    .replace(/^[a-z+]+:\/\//i, '')
    // credentials left after the scheme: user:token@host
    .replace(/^[^@/]*@/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();

  // A local path remote is not an identity — it says where a clone came from, not what the project
  // is. Three shapes to reject: a Windows drive (`C:\repos\x`), a relative path (`../sibling`), and
  // an absolute POSIX path (`/home/juan/repos/x`, which also covers `file:///…` once the scheme is
  // stripped). A host name never starts with a separator or a dot.
  if (
    !s.includes('/') ||
    /^[a-z]:[\\/]/i.test(trimmed) ||
    trimmed.startsWith('.') ||
    trimmed.startsWith('/') ||
    s.startsWith('/')
  ) {
    return '';
  }
  // A host with no path tells us nothing.
  if (s.split('/').length < 2) return '';
  return s;
}

/** Run a git command, returning '' on any failure — git may be absent entirely. */
function git(args: readonly string[], cwd: string): string {
  try {
    return execFileSync('git', args as string[], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Resolve the repository identity for a directory.
 *
 * Never throws: an unresolvable identity degrades to the directory name rather than failing a
 * remember or a recall.
 *
 * @param cwd - Directory to resolve from; defaults to the process working directory, which for a
 *   stdio MCP server is the host's project directory (measured — the server inherits it)
 */
export function resolveProjectIdentity(cwd: string = process.cwd()): ProjectIdentity {
  const root = git(['rev-parse', '--show-toplevel'], cwd) || resolve(cwd);

  const remote = normalizeRemote(git(['config', '--get', 'remote.origin.url'], cwd));
  if (remote) return { id: remote, source: 'remote', root };

  // `--max-parents=0` can list several roots in a grafted history; the first is the oldest.
  const rootCommit = git(['rev-list', '--max-parents=0', 'HEAD'], cwd).split('\n')[0] ?? '';
  if (rootCommit) return { id: `repo:${rootCommit.slice(0, 12)}`, source: 'root-commit', root };

  return { id: `dir:${basename(root)}`, source: 'directory', root };
}

/**
 * Memoised identity for this process.
 *
 * One server process serves one session in one repository, so this is resolved once. It MUST NOT be
 * called from a recall path in a way that could re-shell: `git` in a subprocess is milliseconds, and
 * the <50ms recall contract has no room for it per call.
 */
let cached: ProjectIdentity | null = null;

/** The identity of the repository this process is serving. */
export function getProjectIdentity(): ProjectIdentity {
  cached ??= resolveProjectIdentity();
  return cached;
}

/** Drop the memo. Tests only — a process does not change repository. */
export function resetProjectIdentityCache(): void {
  cached = null;
}

/**
 * The project id to store, given what a caller supplied.
 *
 * An explicit value always wins: a caller who knows better than the filesystem is not overruled
 * (ADR-018 §2). It is simply no longer how identity is normally established.
 *
 * @param explicit - A project supplied by the caller, if any
 */
export function resolveProject(explicit?: string): ProjectIdentity {
  const trimmed = explicit?.trim();
  if (trimmed) return { id: trimmed, source: 'explicit', root: process.cwd() };
  return getProjectIdentity();
}
