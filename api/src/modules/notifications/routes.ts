import type { FastifyInstance } from 'fastify';
import type { NotificationsService } from './service.js';

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

/** How long a quiet stream waits before a comment line, so that no proxy closes it. */
const KEEP_ALIVE_MS = 25_000;

/** The profile's notifications (plan 5, 7.2): settings, the bell, the live stream, a test. */
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

  // A notification on this PC, to see that they work (plan 7.2): whether it was shown.
  app.post('/api/notifications/test', async (req) => ({ shown: await notifications.test(req.owner) }));
}
