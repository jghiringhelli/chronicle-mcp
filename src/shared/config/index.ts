/**
 * Chronicle configuration loader.
 *
 * Reads from ~/.chronicle/config.json. Creates the file with defaults on first run.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ConfigurationError } from '../exceptions/index.js';

export interface ChronicleConfig {
  userId: string;
  deviceId: string;
  dbPath: string;
  railwayUrl?: string;
  logLevel?: string;
  /** Team slug — read by chronicle-team. Ignored by chronicle-mcp. */
  teamId?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.chronicle');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Load configuration from ~/.chronicle/config.json.
 * Creates the file with defaults if it does not exist.
 *
 * @returns Loaded configuration
 * @throws {ConfigurationError} If userId is empty after loading
 */
export function loadConfig(): ChronicleConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaults: ChronicleConfig = {
      userId: '',
      deviceId: `${os.hostname()}-${randomHex(4)}`,
      dbPath: path.join(CONFIG_DIR, 'chronicle.db'),
    };
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
    throw new ConfigurationError(
      `Chronicle config created at ${CONFIG_FILE}. Set userId to your identifier and restart.`,
    );
  }

  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  const config = JSON.parse(raw) as ChronicleConfig;

  if (!config.userId) {
    throw new ConfigurationError(
      `userId is empty in ${CONFIG_FILE}. Set it to your identifier and restart.`,
    );
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
