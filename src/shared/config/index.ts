/**
 * Chronicle configuration loader.
 *
 * Reads from ~/.chronicle/config.json. Creates the file with defaults on first run.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { ConfigurationError } from '../exceptions/index.js';

export interface ChronicleConfig {
  /**
   * The person this store belongs to. **An identity, not a convenience.**
   *
   * It keys team membership (`team_members.user_id`) and every row the cross-machine mirror writes
   * (`memories.user_id`). If it changes, the previous rows become unreachable and the team gate
   * stops recognising this machine — which is exactly what happened once: the config was recreated,
   * `userId` was re-derived from `git config user.email` to a different value than the GitHub handle
   * the team rows used, and the machine silently stopped being a member of its own team.
   *
   * It is derived ONCE, on first run, and then read from disk. Treat it as immutable: changing it
   * requires migrating the rows it owns. `scripts/inspect-cloud-db.mjs` reports a mismatch against
   * the mirror, and the server warns at startup.
   */
  userId: string;
  deviceId: string;
  dbPath: string;
  railwayUrl?: string;
  logLevel?: string;
  /** Team slug — enables Axon coordination sync to Railway. */
  teamId?: string;
  /** Team license token — required to use Axon (team coordination) tools. */
  teamToken?: string;
}

/**
 * Where Chronicle keeps everything: the config file, the database, the intelligence artifacts.
 *
 * Defaults to `~/.chronicle`, and is overridable with `CHRONICLE_HOME`. The override is not a
 * convenience — without it the package is untestable against a real database without writing into
 * the developer's own memory store, which is exactly what happened: the first run of
 * `scripts/smoke-mcp.mjs` left rows in `~/.chronicle/chronicle.db`. A test that pollutes production
 * data is a test nobody runs twice.
 *
 * It also makes a throwaway store trivial, which is what the cloud-sync verification needs before
 * real memories are pointed at a shared Postgres.
 *
 * Read once at module load: a process serves one store for its lifetime, and re-reading would let
 * the database path change under an open handle.
 */
const CONFIG_DIR = process.env['CHRONICLE_HOME']
  ? path.resolve(process.env['CHRONICLE_HOME'])
  : path.join(os.homedir(), '.chronicle');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** The directory this process is using. Exported so tooling can report it rather than guess. */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function gitEmail(): string {
  try {
    return execSync('git config --global user.email', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/**
 * Load configuration from ~/.chronicle/config.json.
 * Creates the file with defaults if it does not exist.
 *
 * @returns Loaded configuration
 * @throws {ConfigurationError} If userId is empty after loading
 */
export function loadConfig(): ChronicleConfig {
  const email = gitEmail();

  if (!fs.existsSync(CONFIG_FILE)) {
    if (!email) {
      throw new ConfigurationError(
        `Chronicle config not found at ${CONFIG_FILE} and no git user.email detected. ` +
        `Run: git config --global user.email "you@example.com" and restart, ` +
        `or create ${CONFIG_FILE} manually with a userId field.`,
      );
    }
    const defaults: ChronicleConfig = {
      userId: email,
      deviceId: `${os.hostname()}-${randomHex(4)}`,
      dbPath: path.join(CONFIG_DIR, 'chronicle.db'),
    };
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
    // A freshly-derived identity on a machine that is meant to join an existing team is the failure
    // mode described on `userId` above. Say so on stderr, which an MCP host shows in its logs,
    // rather than letting the machine quietly own nothing.
    process.stderr.write(
      `chronicle: created ${CONFIG_FILE} with a NEW identity "${defaults.userId}" derived from your ` +
      `git email.
` +
      `  If you already sync or belong to a team under a different id, set "userId" to that id now — ` +
      `it keys every synced row and your team membership.
`,
    );
    return defaults;
  }

  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  const config = JSON.parse(raw) as ChronicleConfig;

  // Backfill userId for existing installs that left it empty.
  if (!config.userId) {
    if (!email) {
      throw new ConfigurationError(
        `userId is empty in ${CONFIG_FILE} and no git user.email detected. ` +
        `Set userId manually or run: git config --global user.email "you@example.com"`,
      );
    }
    config.userId = email;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  }

  return config;
}

let _cachedConfig: ChronicleConfig | null = null;

/**
 * Memoised version of loadConfig().
 *
 * @returns Loaded configuration (cached after first call)
 */
export function getConfig(): ChronicleConfig {
  if (!_cachedConfig) {
    _cachedConfig = loadConfig();
  }
  return _cachedConfig;
}

/**
 * Drop the memoised config so the next `getConfig()` re-reads from disk.
 *
 * For tests and tooling only. Production code MUST NOT call this: the database handle is opened
 * against `dbPath`, so swapping the config underneath an open connection would leave the process
 * writing to one file while believing it uses another.
 */
export function resetConfigCache(): void {
  _cachedConfig = null;
}
