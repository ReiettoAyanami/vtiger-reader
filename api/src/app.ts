import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyServerOptions } from 'fastify';
import { loadConfig, type AuthConfig, type CrmConfig } from './config.js';
import { createPool, pingDatabase, type Pool } from './db/pool.js';
import { AccountLifecycle } from './modules/accounts/service.js';
import { CrmClient } from './modules/crm/client.js';
import { crmLinkRoutes } from './modules/crm/routes.js';
import { CrmLinkService, crmProblem } from './modules/crm/service.js';
import { CrmError, type Fetch } from './modules/crm/webservice.js';
import { adminRoutes } from './modules/admin/routes.js';
import { AdminService } from './modules/admin/service.js';
import { createAuth } from './modules/identity/auth.js';
import { requestUserHook } from './modules/identity/hook.js';
import { Identity } from './modules/identity/identity.js';
import { authDatabase } from './modules/identity/insert-memory.js';
import { accountRoutes, identityRoutes } from './modules/identity/routes.js';
import { SIGN_IN_DELAY, SignInThrottle, type SignInDelay } from './modules/identity/throttle.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { listRoutes } from './modules/lists/routes.js';
import { ListsService } from './modules/lists/service.js';
import { ticketRoutes } from './modules/tickets/routes.js';
import { TicketsService } from './modules/tickets/service.js';
import { SettingsService } from './modules/settings/service.js';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemError,
  problemBody,
  type ProblemBody,
  type ProblemFieldError,
} from './shared/errors.js';
import { SecretBox } from './shared/secret-box.js';
import { securityHeadersHook } from './shared/security-headers.js';
import type { Clock } from './shared/time.js';
import { API_LEVEL, VERSION } from './version.js';

export interface BuildAppOptions {
  /** mysql2 pool. When omitted, one is created from the environment and closed with the app. */
  pool?: Pool;
  /** Fastify logger options (false in tests). */
  logger?: FastifyServerOptions['logger'];
  /** Folder with the Angular build: serves its files and falls back to index.html. */
  webDist?: string | undefined;
  /** Source of "now" (tests pin it). */
  clock?: Clock;
  /**
   * Sign-in settings over the environment's (tests: another address, the counters off, shorter
   * waits, and the sleep of those waits, to see which ones are asked for).
   */
  auth?: Partial<AuthConfig> & { rateLimit?: boolean; signInDelay?: SignInDelay; signInSleep?: (ms: number) => Promise<void> };
  /** The CRM link over the environment's (tests: a fake CRM's fetch, its host allowed, another key). */
  crm?: Partial<CrmConfig> & { fetch?: Fetch; hostAllowed?: (host: string) => Promise<boolean> };
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Who is asking, and the users' credentials (modules/identity). */
    identity: Identity;
    /** Creating users ready to use (modules/accounts). */
    accounts: AccountLifecycle;
    /** Every route of the API, as registered (the cross-user tests cover each one). */
    apiRoutes: ReadonlyArray<{ method: string; url: string }>;
  }
}

function sendProblem(reply: FastifyReply, body: ProblemBody): FastifyReply {
  return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

function validationErrors(err: FastifyError): ProblemFieldError[] {
  return (err.validation ?? []).map((v) => {
    const path = (v.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.');
    const missing = (v.params as { missingProperty?: unknown } | undefined)?.missingProperty;
    const additional = (v.params as { additionalProperty?: unknown } | undefined)?.additionalProperty;
    const field =
      [path, typeof missing === 'string' ? missing : '', typeof additional === 'string' ? additional : '']
        .filter(Boolean)
        .join('.') || (err.validationContext ?? '');
    return { field, message: v.message ?? 'is invalid' };
  });
}

function isApiPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return path === '/api' || path.startsWith('/api/');
}

/** Builds the Fastify instance with every module registered. Used by server.ts and by tests. */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const ownsPool = opts.pool === undefined;
  const pool = opts.pool ?? createPool(loadConfig().db);

  const app = Fastify({
    logger: opts.logger ?? false,
    ajv: {
      customOptions: {
        // Unknown fields are a 400, not silently dropped.
        removeAdditional: false,
        // Decimal inputs are "string or number".
        allowUnionTypes: true,
      },
    },
  });
  if (ownsPool) {
    app.addHook('onClose', async () => {
      await pool.end();
    });
  }

  const authConfig: AuthConfig = { ...loadConfig().auth, ...opts.auth };
  // What every answer tells the browser: before the routes, the 404 handler and the web build.
  securityHeadersHook(app, authConfig.appUrl);

  // Every error leaves as Problem Details.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ProblemError) return sendProblem(reply, error.toBody());
    if (error instanceof CrmError) {
      if (error.kind === 'refused') request.log.error({ err: error }, 'a CRM operation outside the read-only list');
      return sendProblem(reply, crmProblem(error).toBody());
    }
    if (error.validation) {
      return sendProblem(reply, problemBody(400, 'validation', error.message, validationErrors(error)));
    }
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 400 && status < 500) return sendProblem(reply, problemBody(status, null, error.message));
    request.log.error({ err: error }, 'unhandled error');
    return sendProblem(reply, problemBody(500, null, 'An unexpected error occurred'));
  });

  // Unknown /api/* -> 404 problem. Anything else: index.html when a web build is served.
  app.setNotFoundHandler((request, reply) => {
    if (opts.webDist && !isApiPath(request.url) && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.sendFile('index.html');
    }
    const path = request.url.split('?')[0] ?? request.url;
    return sendProblem(reply, problemBody(404, 'not-found', `No route for ${request.method} ${path}`));
  });

  const auth = createAuth(authDatabase(pool), {
    appUrl: authConfig.appUrl,
    secret: authConfig.secret,
    cookiePrefix: authConfig.cookiePrefix,
    rateLimit: opts.auth?.rateLimit ?? true,
    log: (level, message) => app.log[level](message),
  });
  const identity = new Identity(auth, pool);
  app.decorate('identity', identity);

  // Every /api request needs a session, except sign-in, health and version: before any route.
  requestUserHook(app, identity);
  const apiRoutes: Array<{ method: string; url: string }> = [];
  app.decorate('apiRoutes', apiRoutes);
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api')) return;
    for (const method of [route.method].flat()) if (method !== 'HEAD') apiRoutes.push({ method, url: route.url });
  });

  // The CRM: each user's own CRM and account, sealed in crm_link; one client for the whole server.
  const crmConfig: CrmConfig = { ...loadConfig().crm, ...(opts.crm?.encryptionKey ? { encryptionKey: opts.crm.encryptionKey } : {}) };
  const crmClient = new CrmClient({
    ...(opts.crm?.fetch ? { fetch: opts.crm.fetch } : {}),
    ...(opts.crm?.hostAllowed ? { hostAllowed: opts.crm.hostAllowed } : {}),
    credentialsOf: (owner) => links.credentialsOf(owner),
    onLogin: (owner, login) => links.loggedIn(owner, login.crmUserId),
  });
  const links: CrmLinkService = new CrmLinkService(pool, new SecretBox(crmConfig.encryptionKey), crmClient);

  const settings = new SettingsService(pool);
  const accounts = new AccountLifecycle(pool, identity, settings);
  app.decorate('accounts', accounts);

  app.get('/api/health', async (request, reply) => {
    try {
      await pingDatabase(pool);
      return { status: 'ok', db: 'ok' };
    } catch (err) {
      request.log.warn({ err }, 'health check: database unreachable');
      return sendProblem(reply, {
        ...problemBody(503, 'database-unavailable', 'The database does not answer'),
        db: 'error',
      });
    }
  });

  // The product's version, for the corner of every page (version.ts).
  app.get('/api/version', async () => ({ version: VERSION, apiLevel: API_LEVEL }));

  identityRoutes(app, {
    identity,
    throttle: new SignInThrottle(pool, opts.auth?.signInDelay ?? SIGN_IN_DELAY, Date.now, opts.auth?.signInSleep),
    appUrl: authConfig.appUrl,
    clientIpHeader: authConfig.clientIpHeader,
  });
  accountRoutes(app, { identity });
  settingsRoutes(app, { settings });
  crmLinkRoutes(app, { links });
  const lists = new ListsService(pool);
  listRoutes(app, { lists });
  ticketRoutes(app, { tickets: new TicketsService(pool, crmClient, lists), lists });
  adminRoutes(app, { admin: new AdminService(identity, accounts) });

  if (opts.webDist) {
    await app.register(fastifyStatic, { root: opts.webDist, index: ['index.html'], wildcard: true });
  }

  return app;
}
