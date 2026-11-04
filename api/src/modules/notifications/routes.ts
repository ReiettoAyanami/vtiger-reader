import type { FastifyInstance } from 'fastify';
import type { NotificationsService, SubscriptionInput } from './service.js';

const settingsBody = {
  type: 'object',
  additionalProperties: false,
  required: ['enabled', 'lists'],
  properties: {
    enabled: { type: 'boolean' },
    lists: { type: 'array', maxItems: 200, items: { type: 'integer', minimum: 1, maximum: 4294967295 } },
  },
} as const;

const seenBody = {
  type: 'object',
  additionalProperties: false,
  required: ['upTo'],
  properties: { upTo: { type: 'string', minLength: 1, maxLength: 40 } },
} as const;

const base64url = { type: 'string', pattern: '^[A-Za-z0-9_-]+={0,2}$' } as const;

const subscriptionBody = {
  type: 'object',
  // A browser's PushSubscription.toJSON() has expirationTime too: allowed, not kept.
  additionalProperties: false,
  required: ['endpoint', 'keys'],
  properties: {
    endpoint: { type: 'string', minLength: 1, maxLength: 1000 },
    expirationTime: { type: ['number', 'null'] },
    keys: {
      type: 'object',
      additionalProperties: false,
      required: ['p256dh', 'auth'],
      properties: { p256dh: { ...base64url, maxLength: 200 }, auth: { ...base64url, maxLength: 100 } },
    },
  },
} as const;

const endpointBody = {
  type: 'object',
  additionalProperties: false,
  required: ['endpoint'],
  properties: { endpoint: { type: 'string', minLength: 1, maxLength: 1000 } },
} as const;

/** How long a quiet stream waits before a comment line, so that no proxy closes it. */
const KEEP_ALIVE_MS = 25_000;

/** The session's user's notifications (plan 5): settings, the bell, the live stream, their browsers. */
export function notificationRoutes(app: FastifyInstance, deps: { notifications: NotificationsService }): void {
  const { notifications } = deps;
  // The open streams: ended when the server stops (otherwise it would wait for them).
  const streams = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const close of [...streams]) close();
  });

  app.get('/api/notifications/settings', async (req) => notifications.settings(req.owner));

  app.put<{ Body: { enabled: boolean; lists: number[] } }>('/api/notifications/settings', { schema: { body: settingsBody } }, async (req) =>
    notifications.updateSettings(req.owner, req.body),
  );

  app.get('/api/notifications', async (req) => notifications.bell(req.owner));

  app.post<{ Body: { upTo: string } }>('/api/notifications/seen', { schema: { body: seenBody } }, async (req, reply) => {
    await notifications.seen(req.owner, req.body.upTo);
    return reply.code(204).send();
  });

  // An open page of the app: "tickets" when the check finds new ones for its user.
  app.get('/api/notifications/stream', async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    });
    const write = (text: string) => {
      if (!reply.raw.writableEnded) reply.raw.write(text);
    };
    // A browser that loses the stream tries again after this long.
    write('retry: 10000\n\n');
    write('event: ready\ndata: {}\n\n');
    const stop = notifications.listen(req.owner, (event) => write(`event: tickets\ndata: ${JSON.stringify(event)}\n\n`));
    const keepAlive = setInterval(() => write(': keep-alive\n\n'), KEEP_ALIVE_MS);
    const close = () => {
      streams.delete(close);
      clearInterval(keepAlive);
      stop();
      if (!reply.raw.writableEnded) reply.raw.end();
    };
    streams.add(close);
    req.raw.on('close', close);
  });

  app.get('/api/push/key', async () => ({ publicKey: await notifications.publicKey() }));

  app.put<{ Body: SubscriptionInput }>('/api/push/subscription', { schema: { body: subscriptionBody } }, async (req, reply) => {
    await notifications.subscribe(req.owner, { endpoint: req.body.endpoint, keys: req.body.keys });
    return reply.code(204).send();
  });

  // A POST: some proxies drop the body of a DELETE.
  app.post<{ Body: { endpoint: string } }>('/api/push/subscription/delete', { schema: { body: endpointBody } }, async (req, reply) => {
    await notifications.unsubscribe(req.owner, req.body.endpoint);
    return reply.code(204).send();
  });

  app.post('/api/push/test', async (req) => ({ sent: await notifications.test(req.owner) }));
}
