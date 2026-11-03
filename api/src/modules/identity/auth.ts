import { betterAuth } from 'better-auth';
import { admin, username } from 'better-auth/plugins';
import type { AuthConfig } from '../../config.js';
import type { AuthDatabase } from './insert-memory.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './passwords.js';

/**
 * Better Auth for this API (design-accounts.md, "Identity", "Identity as built (1.1)"): users by
 * username and password only, sessions in the database for 30 days and refreshed by use, roles
 * `user` and `admin`, impersonation, the sign-in counters in the database. Its tables carry our
 * names (migration 008), its fields are mapped one by one. Only Identity holds this object: every
 * call goes through `runAuth()` (insert-memory.ts).
 */

/** The header our auth routes set to the client's IP; whatever a client sends under it is dropped. */
export const CLIENT_IP_HEADER = 'x-vtiger-reader-client-ip';

export const SESSION_DAYS = 30;
export const IMPERSONATION_MINUTES = 60;
export const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

export type AuthLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AuthOptions extends Pick<AuthConfig, 'appUrl' | 'secret' | 'cookiePrefix'> {
  /** The sign-in counters (on, except in tests that sign in many times from one address). */
  rateLimit: boolean;
  /** Where the library's warnings and errors go (the API's log). */
  log?: (level: AuthLogLevel, message: string) => void;
}

export function createAuth(database: AuthDatabase, options: AuthOptions) {
  const log = options.log;
  return betterAuth({
    appName: 'vtiger-reader',
    baseURL: options.appUrl,
    basePath: '/api/auth',
    secret: options.secret,
    database,
    telemetry: { enabled: false },
    logger: log ? { level: 'warn', log: (level, message) => log(level, `better-auth: ${message}`) } : { disabled: true },
    trustedOrigins: [options.appUrl],
    user: {
      modelName: 'users',
      fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    session: {
      modelName: 'sessions',
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      // No signed-cookie cache: every request reads its session, so a blocked or deleted user is out at once.
      cookieCache: { enabled: false },
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      modelName: 'accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'verifications',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    emailAndPassword: {
      enabled: true,
      // Users are created by administrators (and the first one at startup), never by signing up.
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
    },
    rateLimit: {
      enabled: options.rateLimit,
      storage: 'database',
      modelName: 'rate_limits',
      fields: { lastRequest: 'last_request' },
    },
    advanced: {
      database: {
        // MySQL's own AUTO_INCREMENT ids, read back through insert-memory.ts.
        generateId: 'serial',
        // The schema is ours, the numbered migrations (design-accounts.md, "Identity"). Better
        // Auth's own check runs as soon as this object exists, which at the first start of an
        // instance is before the migrations create the tables, and it keeps its "tables missing"
        // until its own `migrate` (never used here) clears it: no first administrator, every
        // sign-in refused until a restart (seen on a new demo database, 2026-10-03). The tests
        // check every auth path on our schema instead (test/identity/schema.test.ts).
        validateSchema: false,
      },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      cookiePrefix: options.cookiePrefix,
    },
    // Signing in is by username only.
    disabledPaths: ['/sign-in/email'],
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
        // Any case is accepted when signing in; a username is stored lowercase.
        usernameValidator: (value) => USERNAME_PATTERN.test(value.toLowerCase()),
        displayUsername: false,
        immutableUsername: true,
      }),
      admin({
        defaultRole: 'user',
        adminRoles: ['admin'],
        allowImpersonatingAdmins: true,
        impersonationSessionDuration: IMPERSONATION_MINUTES * 60,
        schema: {
          user: { fields: { banReason: 'ban_reason', banExpires: 'ban_expires' } },
          session: { fields: { impersonatedBy: 'impersonated_by' } },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
