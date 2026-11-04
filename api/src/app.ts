import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyServerOptions } from 'fastify';
import { loadConfig, type CrmConfig } from './config.js';
import { createPool, pingDatabase, type Pool } from './db/pool.js';
import { CrmClient } from './modules/crm/client.js';
import { crmLinkRoutes } from './modules/crm/routes.js';
import { CrmLinkService, crmProblem } from './modules/crm/service.js';
import { CrmError, type Fetch } from './modules/crm/webservice.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { AiError } from './modules/ai/adapter.js';
import { aiRoutes } from './modules/ai/routes.js';
import { AiService } from './modules/ai/service.js';
import { listRoutes } from './modules/lists/routes.js';
import { logNotifier, type Notifier } from './modules/notifications/notifier.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { NotificationsService } from './modules/notifications/service.js';
import { ListsService } from './modules/lists/service.js';
import { localProfileHook } from './modules/profile/profile.js';
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
import { systemClock, type Clock } from './shared/time.js';
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
  /** The address the app is opened at, over the environment's APP_URL: the security headers (HSTS on https). */
  appUrl?: string;
  /** The AI providers' HTTP client and host check (tests: fake providers). */
  ai?: { fetch?: typeof fetch; hostAllowed?: (host: string) => Promise<boolean>; privateHosts?: string[]; claudeCode?: string[] };
  /** The CRM link over the environment's (tests: a fake CRM's fetch, its host allowed, another key). */
  crm?: Partial<CrmConfig> & { fetch?: Fetch; hostAllowed?: (host: string) => Promise<boolean> };
  /** Where the notifications go (plan 7.2): the desktop's; a log line when omitted (the bare server). */
  notifier?: Notifier;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** New tickets for each user (modules/notifications): server.ts starts its checks. */
    notifications: NotificationsService;
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

/** An AI provider's failure, before any answer was streamed, as a problem. */
function aiProblem(error: AiError): ProblemBody {
  switch (error.kind) {
    case 'auth':
      return problemBody(409, 'ai-auth', error.message);
    case 'rate-limit':
      return problemBody(429, 'ai-rate-limit', error.message);
    case 'unreachable':
      return problemBody(503, 'ai-unreachable', error.message);
    case 'address':
      return problemBody(409, 'ai-address', error.message);
    case 'bad-request':
      return problemBody(400, 'ai-bad-request', error.message);
    default:
      return problemBody(502, 'ai-error', error.message);
  }
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

  const appUrl = opts.appUrl ?? loadConfig().appUrl;
  // What every answer tells the browser: before the routes, the 404 handler and the web build.
  securityHeadersHook(app, appUrl);

  // Every error leaves as Problem Details.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ProblemError) return sendProblem(reply, error.toBody());
    if (error instanceof AiError) return sendProblem(reply, aiProblem(error));
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

  // Every request works for the app's one profile (plan 7.1): no accounts, no sign-in.
  localProfileHook(app);
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

  settingsRoutes(app, { settings });
  crmLinkRoutes(app, { links });
  const lists = new ListsService(pool);
  listRoutes(app, { lists });
  const tickets = new TicketsService(pool, crmClient, lists);
  ticketRoutes(app, { tickets, lists });
  const ai = new AiService(pool, new SecretBox(crmConfig.encryptionKey), {
    privateHosts: opts.ai?.privateHosts ?? loadConfig().ai.privateHosts,
    claudeCode: opts.ai?.claudeCode ?? loadConfig().ai.claudeCode,
    ...(opts.ai?.fetch ? { fetch: opts.ai.fetch } : {}),
    ...(opts.ai?.hostAllowed ? { hostAllowed: opts.ai.hostAllowed } : {}),
  });
  aiRoutes(app, { ai, tickets, settings });
  const notifications = new NotificationsService(pool, tickets, lists, opts.notifier ?? logNotifier(app.log), {
    clock: opts.clock ?? systemClock,
    log: app.log,
  });
  app.decorate('notifications', notifications);
  app.addHook('onClose', async () => notifications.stop());
  notificationRoutes(app, { notifications });

  if (opts.webDist) {
    await app.register(fastifyStatic, { root: opts.webDist, index: ['index.html'], wildcard: true });
  }

  return app;
}
