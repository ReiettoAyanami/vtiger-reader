import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { IdParams } from '../../shared/schemas.js';
import { toHeaders } from '../identity/hook.js';
import type { RequestUser } from '../identity/identity.js';
import { createUserSchema, updateUserSchema, userIdSchema, type CreateUserBody, type UpdateUserBody } from './schemas.js';
import type { Actor, AdminService } from './service.js';

/**
 * The admin view's routes (design-accounts.md, "Admin routes"). Only administrators reach them,
 * and not while impersonating: for anyone else they answer as routes that do not exist (the
 * request hook). A user is `{ id, username, email, role, blocked, hasPassword, createdAt }`
 * (`UserSummary`).
 */
export function adminRoutes(app: FastifyInstance, deps: { admin: AdminService }): void {
  const { admin } = deps;
  const actor = (req: FastifyRequest): Actor => ({ user: req.user as RequestUser, owner: req.owner });

  app.get('/api/admin/users', async () => admin.list());

  app.post<{ Body: CreateUserBody }>('/api/admin/users', { schema: createUserSchema }, async (req, reply) => {
    const user = await admin.create(actor(req), req.body);
    return reply.code(201).send(user);
  });

  app.patch<{ Params: IdParams; Body: UpdateUserBody }>('/api/admin/users/:id', { schema: updateUserSchema }, async (req) =>
    admin.update(actor(req), req.params.id, req.body),
  );

  app.delete<{ Params: IdParams }>('/api/admin/users/:id', { schema: userIdSchema }, async (req, reply) => {
    await admin.remove(actor(req), req.params.id);
    req.log.info({ deletedUser: req.params.id, by: req.user?.userId }, 'user deleted');
    return reply.code(204).send();
  });

  // The browser's session becomes the user's; the administrator's own waits in a signed cookie.
  app.post<{ Params: IdParams }>('/api/admin/users/:id/impersonate', { schema: userIdSchema }, async (req, reply) => {
    const { user, cookies } = await admin.impersonate(actor(req), req.params.id, toHeaders(req.headers));
    req.log.info({ impersonation: { by: req.user?.userId, as: user.id, username: user.username } }, 'impersonation started');
    reply.header('set-cookie', cookies);
    return { user };
  });

  // Never cached: a password shown once in the user form.
  app.get('/api/admin/generated-password', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { password: admin.generatedPassword() };
  });
}
