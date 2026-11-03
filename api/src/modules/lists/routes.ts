import type { FastifyInstance } from 'fastify';
import { idParams, type IdParams } from '../../shared/schemas.js';
import { listFilterSchema } from './filter.js';
import type { ListInput, ListsService } from './service.js';

const listBody = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'filter'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    filter: listFilterSchema,
  },
} as const;

const orderBody = {
  type: 'object',
  additionalProperties: false,
  required: ['ids'],
  properties: { ids: { type: 'array', maxItems: 200, items: { type: 'integer', minimum: 1, maximum: 4294967295 } } },
} as const;

/** The session's user's own lists of tickets. */
export function listRoutes(app: FastifyInstance, deps: { lists: ListsService }): void {
  const { lists } = deps;

  app.get('/api/lists', async (req) => lists.all(req.owner));

  app.post<{ Body: ListInput }>('/api/lists', { schema: { body: listBody } }, async (req, reply) =>
    reply.code(201).send(await lists.create(req.owner, req.body)),
  );

  app.put<{ Body: { ids: number[] } }>('/api/lists/order', { schema: { body: orderBody } }, async (req) => lists.reorder(req.owner, req.body.ids));

  app.put<{ Params: IdParams; Body: ListInput }>('/api/lists/:id', { schema: { params: idParams, body: listBody } }, async (req) =>
    lists.update(req.owner, req.params.id, req.body),
  );

  app.delete<{ Params: IdParams }>('/api/lists/:id', { schema: { params: idParams } }, async (req, reply) => {
    await lists.remove(req.owner, req.params.id);
    return reply.code(204).send();
  });
}
