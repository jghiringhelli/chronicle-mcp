import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeRemote,
  resolveProjectIdentity,
  resolveProject,
  resetProjectIdentityCache,
} from '../../../src/shared/repo-identity.js';

/**
 * Repository identity (ADR-018 §2).
 *
 * The normalisation cases below are not invented — they are the forms measured across the 25
 * repositories in this workspace when the rule was written, including the two that prove a
 * directory-derived id would be wrong: `mcp/chronicle` sits in a directory called `chronicle` with
 * the remote `chronicle-mcp`, and `mcp/CodeSeeker` is capitalised while its remote is not.
 */
describe('normalizeRemote', () => {
  it('normalises the https form, dropping the .git suffix', () => {
    expect(normalizeRemote('https://github.com/jghiringhelli/chronicle-mcp.git'))
      .toBe('github.com/jghiringhelli/chronicle-mcp');
  });

  it('normalises the scp-like ssh form to the same id as https', () => {
    // The same repository cloned over ssh on one machine and https on another MUST resolve
    // identically, or project scope does not join across machines — the point of the scope.
    const viaSsh = normalizeRemote('git@github.com:jghiringhelli/chronicle-mcp.git');
    const viaHttps = normalizeRemote('https://github.com/jghiringhelli/chronicle-mcp');

    expect(viaSsh).toBe('github.com/jghiringhelli/chronicle-mcp');
    expect(viaSsh).toBe(viaHttps);
  });

  it('normalises the ssh:// form', () => {
    expect(normalizeRemote('ssh://git@github.com/jghiringhelli/loom.git'))
      .toBe('github.com/jghiringhelli/loom');
  });

  it('lowercases, so a capitalised clone matches its lowercase remote', () => {
    // Measured: mcp/CodeSeeker vs github.com/jghiringhelli/codeseeker.
    expect(normalizeRemote('https://github.com/jghiringhelli/CodeSeeker.git'))
      .toBe('github.com/jghiringhelli/codeseeker');
  });

  it('strips credentials embedded in the URL', () => {
    // A project id is stored and logged. A token must never ride along in it.
    const out = normalizeRemote('https://jghiringhelli:ghp_secrettoken@github.com/owner/repo.git');

    expect(out).toBe('github.com/owner/repo');
    expect(out).not.toContain('ghp_');
    expect(out).not.toContain('jghiringhelli:');
  });

  it('keeps a non-GitHub host, because identity is host-qualified', () => {
    // Two repos named owner/app on different hosts are different projects.
    expect(normalizeRemote('https://gitlab.com/owner/app.git')).toBe('gitlab.com/owner/app');
    expect(normalizeRemote('https://gitlab.com/owner/app'))
      .not.toBe(normalizeRemote('https://github.com/owner/app'));
  });

  it('tolerates a trailing slash', () => {
    expect(normalizeRemote('https://github.com/owner/repo/')).toBe('github.com/owner/repo');
  });

  it('rejects input that is not a remote identity', () => {
    for (const bad of ['', '   ', 'https://github.com', 'github.com', '../sibling-repo', './x']) {
      expect(normalizeRemote(bad)).toBe('');
    }
  });

  it('rejects a local filesystem path used as a remote', () => {
    // A path remote says where a clone came from, not what the project is.
    expect(normalizeRemote('C:\\repos\\other-copy')).toBe('');
    expect(normalizeRemote('/home/juan/repos/other-copy')).toBe('');
  });
});

describe('resolveProjectIdentity', () => {
  let dir: string;
  const dirs: string[] = [];

  const makeDir = () => {
    const d = mkdtempSync(join(tmpdir(), 'repo-identity-'));
    dirs.push(d);
    return d;
  };

  const run = (args: string[], cwd: string) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

  const initRepo = (d: string, { remote }: { remote?: string } = {}) => {
    run(['init', '--quiet'], d);
    run(['config', 'user.email', 'test@example.com'], d);
    run(['config', 'user.name', 'Test'], d);
    run(['config', 'commit.gpgsign', 'false'], d);
    writeFileSync(join(d, 'a.txt'), 'hello', 'utf8');
    run(['add', '.'], d);
    run(['commit', '--quiet', '-m', 'initial'], d);
    if (remote) run(['remote', 'add', 'origin', remote], d);
  };

  beforeEach(() => {
    resetProjectIdentityCache();
    dir = makeDir();
  });

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('prefers the normalised remote', () => {
    initRepo(dir, { remote: 'git@github.com:jghiringhelli/chronicle-mcp.git' });

    const identity = resolveProjectIdentity(dir);

    expect(identity.id).toBe('github.com/jghiringhelli/chronicle-mcp');
    expect(identity.source).toBe('remote');
  });

  it('falls back to the root commit when there is no remote', () => {
    // Measured: one of the 25 repositories (jc-studio/enjambre) has no remote.
    initRepo(dir);

    const identity = resolveProjectIdentity(dir);

    expect(identity.source).toBe('root-commit');
    expect(identity.id).toMatch(/^repo:[0-9a-f]{12}$/);
  });

  it('falls back to the directory name outside a git repository', () => {
    const plain = join(makeDir(), 'not-a-repo');
    mkdirSync(plain, { recursive: true });

    const identity = resolveProjectIdentity(plain);

    expect(identity.source).toBe('directory');
    expect(identity.id).toBe('dir:not-a-repo');
  });

  it('prefixes the unstable fallbacks, so a reader can see them', () => {
    initRepo(dir);

    // `repo:` and `dir:` announce "this is a fallback"; a remote id never has a prefix.
    expect(resolveProjectIdentity(dir).id.startsWith('repo:')).toBe(true);
  });

  it('resolves the same id from a subdirectory of the repository', () => {
    initRepo(dir, { remote: 'https://github.com/owner/repo.git' });
    const sub = join(dir, 'src', 'deep');
    mkdirSync(sub, { recursive: true });

    expect(resolveProjectIdentity(sub).id).toBe(resolveProjectIdentity(dir).id);
  });

  it('gives two different repositories different ids', () => {
    initRepo(dir, { remote: 'https://github.com/owner/one.git' });
    const other = makeDir();
    initRepo(other, { remote: 'https://github.com/owner/two.git' });

    expect(resolveProjectIdentity(dir).id).not.toBe(resolveProjectIdentity(other).id);
  });

  it('gives the same id to two clones in differently-named directories', () => {
    // THE case the whole rule exists for: the same repository on two machines, cloned under
    // different directory names, must be one project.
    const remote = 'https://github.com/jghiringhelli/chronicle-mcp.git';
    const machineA = join(makeDir(), 'chronicle');
    const machineB = join(makeDir(), 'chronicle-mcp');
    mkdirSync(machineA, { recursive: true });
    mkdirSync(machineB, { recursive: true });
    initRepo(machineA, { remote });
    initRepo(machineB, { remote });

    expect(resolveProjectIdentity(machineA).id).toBe(resolveProjectIdentity(machineB).id);
  });

  it('reports the repository root, not the subdirectory it was called from', () => {
    initRepo(dir, { remote: 'https://github.com/owner/repo.git' });
    const sub = join(dir, 'nested');
    mkdirSync(sub, { recursive: true });

    // Resolved through git, so it is the toplevel. Compared loosely because macOS temp dirs are
    // symlinked (/var -> /private/var) and this assertion is about the shape, not the prefix.
    expect(resolveProjectIdentity(sub).root.endsWith('nested')).toBe(false);
  });

  it('never throws, whatever the directory', () => {
    expect(() => resolveProjectIdentity(join(dir, 'does', 'not', 'exist'))).not.toThrow();
  });
});

describe('resolveProject', () => {
  beforeEach(() => resetProjectIdentityCache());

  it('lets an explicit project win over detection', () => {
    const identity = resolveProject('my-explicit-label');

    expect(identity.id).toBe('my-explicit-label');
    expect(identity.source).toBe('explicit');
  });

  it('trims an explicit project', () => {
    expect(resolveProject('  spaced  ').id).toBe('spaced');
  });

  it('falls through to detection for an empty or whitespace value', () => {
    // An agent passing '' must not create a project whose id is the empty string.
    for (const blank of ['', '   ', undefined]) {
      expect(resolveProject(blank).source).not.toBe('explicit');
    }
  });
});
