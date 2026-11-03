import { isAbsolute, resolve } from 'node:path';

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** How users sign in (design-accounts.md, "Identity"). */
export interface AuthConfig {
  /** The instance's address, as the browser sees it (APP_URL): the only trusted origin. */
  appUrl: string;
  /** Signs the session cookies (AUTH_SECRET). */
  secret: string;
  /** Prefix of the cookie names (COOKIE_PREFIX): dev and prod on one machine must differ. */
  cookiePrefix: string;
  /** Header the instance's proxy sets to the client's IP (CLIENT_IP_HEADER); unset, the connection's. */
  clientIpHeader: string | undefined;
}

/** The instance's first administrator, created at startup when there is none (design-accounts.md, "first account"). */
export interface FirstAdminConfig {
  /** ADMIN_USERNAME: permanent, it lives in every URL; unset, no administrator is created. */
  username: string | undefined;
  /** ADMIN_EMAIL (a fake address for now: lenzi, 2026-10-03). */
  email: string;
  /** FIRST_ADMIN_PASSWORD_FILE: where its password is written (the project root, mounted). */
  passwordFile: string;
}

export interface AppConfig {
  db: DbConfig;
  auth: AuthConfig;
  firstAdmin: FirstAdminConfig;
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

/** Development only: a production instance refuses to start without its own AUTH_SECRET. */
export const DEV_AUTH_SECRET = 'vtiger-reader-development-secret-never-for-production';

function authConfig(env: Env): AuthConfig {
  const production = env.NODE_ENV === 'production';
  const rawUrl = env.APP_URL?.trim();
  const secret = env.AUTH_SECRET?.trim();
  if (production && !rawUrl) {
    throw new Error('APP_URL must be set in production: the address the instance is opened at, e.g. https://tickets.example.com');
  }
  if (production && (!secret || secret.length < 32)) {
    throw new Error('AUTH_SECRET must be set in production, at least 32 characters (e.g. openssl rand -base64 32)');
  }
  const appUrl = rawUrl || 'http://localhost:4200';
  let origin: string;
  try {
    origin = new URL(appUrl).origin;
  } catch {
    throw new Error(`APP_URL must be a full address such as https://tickets.example.com, got "${appUrl}"`);
  }
  if (origin === 'null') throw new Error(`APP_URL must be an http or https address, got "${appUrl}"`);
  return {
    appUrl: origin,
    secret: secret || DEV_AUTH_SECRET,
    cookiePrefix: str(env, 'COOKIE_PREFIX', 'vtiger-reader'),
    clientIpHeader: env.CLIENT_IP_HEADER?.trim().toLowerCase() || undefined,
  };
}

export function loadConfig(env: Env = process.env): AppConfig {
  const database = str(env, 'DB_NAME', 'vtiger_reader');
  return {
    auth: authConfig(env),
    firstAdmin: {
      username: env.ADMIN_USERNAME?.trim().toLowerCase() || undefined,
      email: str(env, 'ADMIN_EMAIL', 'admin@example.invalid'),
      passwordFile: str(env, 'FIRST_ADMIN_PASSWORD_FILE', '/project/to_delete.password.txt'),
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
