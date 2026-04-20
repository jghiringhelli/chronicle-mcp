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

const CONFIG_DIR = path.join(os.homedir(), '.chronicle');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

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
