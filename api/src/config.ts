import { isAbsolute, resolve } from 'node:path';
import { DEV_ENCRYPTION_KEY, parseEncryptionKey } from './shared/secret-box.js';

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** The CRM link. Each user sets their CRM's address from the interface (lenzi, 2026-11-03). */
export interface CrmConfig {
  /** ENCRYPTION_KEY: seals the users' CRM access keys (and later their AI keys) in the database. */
  encryptionKey: Buffer;
}

/** The AI help (plan 4): each user's own providers, configured from the interface. */
export interface AiConfig {
  /**
   * AI_PRIVATE_HOSTS: hosts on this network a provider may live on (a local Ollama), comma
   * separated, e.g. "ollama.lan,192.168.1.20:11434". Any other provider address must be https on
   * the public internet: a user cannot make the server call this machine or the LAN.
   */
  privateHosts: string[];
  /** CLAUDE_CODE_BIN: how to run Claude Code for the "Claude Code (subscription)" providers; "claude" when unset. */
  claudeCode: string[];
}

export interface AppConfig {
  db: DbConfig;
  crm: CrmConfig;
  ai: AiConfig;
  /** APP_URL: the address the app is opened at; only its origin is kept. */
  appUrl: string;
  /** Name of the test database (dev only), `${DB_NAME}_test` when TEST_DB_NAME is unset. */
  testDbName: string;
  host: string;
  port: number;
  logLevel: string;
  /** Folder with the Angular build. Static files + SPA fallback only when set. */
  webDist: string | undefined;
  /** Optional override of the migrations folder. */
  migrationsDir: string | undefined;
}

type Env = Record<string, string | undefined>;

function str(env: Env, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function int(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`Environment variable ${name} must be a port number, got "${raw}"`);
  }
  return value;
}

function optionalPath(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim();
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

/** APP_URL's origin; the dev server's address when unset. */
function appUrlOf(env: Env): string {
  const appUrl = env.APP_URL?.trim() || 'http://localhost:4200';
  let origin: string;
  try {
    origin = new URL(appUrl).origin;
  } catch {
    throw new Error(`APP_URL must be a full address such as http://127.0.0.1:3000, got "${appUrl}"`);
  }
  if (origin === 'null') throw new Error(`APP_URL must be an http or https address, got "${appUrl}"`);
  return origin;
}

function crmConfig(env: Env): CrmConfig {
  const production = env.NODE_ENV === 'production';
  const rawKey = env.ENCRYPTION_KEY?.trim();
  if (production && !rawKey) {
    throw new Error('ENCRYPTION_KEY must be set in production, 32 bytes in base64 (openssl rand -base64 32)');
  }
  return { encryptionKey: rawKey ? parseEncryptionKey(rawKey) : DEV_ENCRYPTION_KEY };
}

export function loadConfig(env: Env = process.env): AppConfig {
  const database = str(env, 'DB_NAME', 'vtiger_reader');
  return {
    appUrl: appUrlOf(env),
    crm: crmConfig(env),
    ai: {
      privateHosts: (env.AI_PRIVATE_HOSTS ?? '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
      claudeCode: (env.CLAUDE_CODE_BIN?.trim() || 'claude').split(/\s+/),
    },
    db: {
      host: str(env, 'DB_HOST', 'localhost'),
      port: int(env, 'DB_PORT', 3306),
      database,
      user: str(env, 'DB_USER', 'vtiger'),
      // Passwords are taken verbatim (no trim).
      password: env.DB_PASSWORD ?? '',
    },
    testDbName: str(env, 'TEST_DB_NAME', `${database}_test`),
    host: str(env, 'HOST', '0.0.0.0'),
    port: int(env, 'PORT', 3000),
    logLevel: str(env, 'LOG_LEVEL', 'info'),
    webDist: optionalPath(env, 'WEB_DIST'),
    migrationsDir: optionalPath(env, 'MIGRATIONS_DIR'),
  };
}
