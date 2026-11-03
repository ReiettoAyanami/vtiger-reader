import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../shared/errors.js';
import type { ListsService } from '../lists/service.js';
import { MAX_NAMES, type ListQuery, type TicketsService } from './service.js';
import {
  customersSchema,
  namesSchema,
  fileSchema,
  listSchema,
  markSchema,
  ticketParams,
  type FileParams,
  type MarkBody,
  type TicketParams,
} from './schemas.js';

/**
 * A file sent from the app's own address: the browser must never run it. Images and PDFs open in
 * place, with nothing they may load; anything else is only downloaded (files.ts, opensInline).
 */
const FILE_POLICY = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'";

/** "attachment; filename=..." with the name as it is, for every browser (RFC 6266, RFC 5987). */
function disposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** The tickets of the user's own CRM: read-only, no route writes to the CRM (plan 3.8). */
export function ticketRoutes(app: FastifyInstance, deps: { tickets: TicketsService; lists: ListsService }): void {
  const { tickets, lists } = deps;

  app.get('/api/tickets/options', async (req) => tickets.options(req.owner));

  app.get('/api/lists/counts', async (req) => tickets.listCounts(req.owner, lists));

  // The names behind a list's ids (organizations: plan 3), read after the list is shown.
  app.get<{ Querystring: { ids: string } }>('/api/names', { schema: namesSchema }, async (req) => {
    const ids = [...new Set(req.query.ids.split(',').map((id) => id.trim()))];
    if (ids.length > MAX_NAMES || ids.some((id) => !/^\d+x\d+$/.test(id))) throw badRequest(`At most ${MAX_NAMES} record ids, such as 11x42`, 'ids');
    return Object.fromEntries(await tickets.names(req.owner, ids));
  });

  app.get<{ Querystring: ListQuery }>('/api/tickets', { schema: listSchema }, async (req) => tickets.list(req.owner, req.query));

  app.get<{ Params: TicketParams }>('/api/tickets/:id', { schema: { params: ticketParams } }, async (req) =>
    tickets.detail(req.owner, req.params.id),
  );

  app.get<{ Params: TicketParams }>('/api/tickets/:id/attachments', { schema: { params: ticketParams } }, async (req) =>
    tickets.attachments(req.owner, req.params.id),
  );

  app.get<{ Params: FileParams; Querystring: { download?: boolean } }>('/api/tickets/:id/files/:fileId', { schema: fileSchema }, async (req, reply) => {
    const file = await tickets.file(req.owner, req.params.id, req.params.fileId);
    const inline = file.inline && !req.query.download;
    return reply
      .header('content-type', inline ? file.type : 'application/octet-stream')
      .header('content-disposition', disposition(inline ? 'inline' : 'attachment', file.name))
      .header('content-security-policy', FILE_POLICY)
      // The user's own: kept by their browser only, for a while (the same image shows again).
      .header('cache-control', 'private, max-age=3600')
      .send(file.data);
  });

  app.put<{ Params: FileParams; Body: MarkBody }>('/api/tickets/:id/files/:fileId/mark', { schema: markSchema }, async (req) => ({
    mark: await tickets.mark(req.owner, req.params.id, req.params.fileId, req.body.mark),
  }));

  app.get<{ Querystring: { q: string } }>('/api/customers', { schema: customersSchema }, async (req) => tickets.customers(req.owner, req.query.q));
}
