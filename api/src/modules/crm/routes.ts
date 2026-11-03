import type { FastifyInstance } from 'fastify';
import { crmLinkPutSchema, type CrmLinkPutBody } from './schemas.js';
import type { CrmLinkService } from './service.js';

/** The session's user's own CRM account. */
export function crmLinkRoutes(app: FastifyInstance, deps: { links: CrmLinkService }): void {
  const { links } = deps;

  app.get('/api/crm/link', async (req) => links.status(req.owner));

  app.put<{ Body: CrmLinkPutBody }>('/api/crm/link', { schema: crmLinkPutSchema }, async (req) => links.link(req.owner, req.body));

  app.delete('/api/crm/link', async (req, reply) => {
    await links.unlink(req.owner);
    return reply.code(204).send();
  });
}
