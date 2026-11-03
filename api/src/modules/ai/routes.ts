import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../shared/errors.js';
import { idParams, type IdParams } from '../../shared/schemas.js';
import type { SettingsService } from '../settings/service.js';
import type { TicketsService } from '../tickets/service.js';
import { AiError, PROVIDER_KINDS } from './adapter.js';
import { messagesFor, systemPrompt, type ThreadTurn } from './prompts.js';
import { TASK_SLOTS, TASKS, type AiService, type ProviderInput, type Task, type TaskModels } from './service.js';

const providerBody = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'label'],
  properties: {
    kind: { type: 'string', enum: [...PROVIDER_KINDS] },
    label: { type: 'string', minLength: 1, maxLength: 80 },
    baseUrl: { type: ['string', 'null'], maxLength: 200 },
    apiKey: { type: 'string', maxLength: 500 },
  },
} as const;

const choice = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['providerId', 'model'],
  properties: {
    providerId: { type: 'integer', minimum: 1, maximum: 4294967295 },
    model: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

const tasksBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: Object.fromEntries(TASK_SLOTS.map((slot) => [slot, choice])),
} as const;

const askBody = {
  type: 'object',
  additionalProperties: false,
  required: ['task'],
  properties: {
    task: { type: 'string', enum: [...TASKS] },
    question: { type: 'string', maxLength: 4000 },
    thread: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['user', 'assistant'] },
          task: { type: 'string', enum: [...TASKS] },
          question: { type: 'string', maxLength: 4000 },
          text: { type: 'string', maxLength: 20000 },
        },
      },
    },
  },
} as const;

const ticketParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^\\d+x\\d+$', maxLength: 40 } },
} as const;

interface AskBody {
  task: Task;
  question?: string;
  thread?: Array<{ role: 'user' | 'assistant'; task?: Task; question?: string; text?: string }>;
}

/** The turns as the prompts read them; a user turn without its task is not one. */
function threadOf(body: AskBody): ThreadTurn[] {
  return (body.thread ?? []).map((turn, i) => {
    if (turn.role === 'assistant') return { role: 'assistant' as const, text: turn.text ?? '' };
    if (!turn.task) throw badRequest('A user turn names its task', `thread.${i}.task`);
    return { role: 'user' as const, task: turn.task, ...(turn.question ? { question: turn.question } : {}) };
  });
}

/** One server-sent event. */
function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * The AI help (plan 4): the user's providers and choices, their usage, and the panel's requests on
 * a ticket, answered as server-sent events. Read-only towards the CRM: the ticket is read, never
 * written; a draft reply is only text for the user to copy.
 */
export function aiRoutes(app: FastifyInstance, deps: { ai: AiService; tickets: TicketsService; settings: SettingsService }): void {
  const { ai, tickets, settings } = deps;

  app.get('/api/ai/providers', async (req) => ai.providers(req.owner));

  app.post<{ Body: ProviderInput }>('/api/ai/providers', { schema: { body: providerBody } }, async (req, reply) =>
    reply.code(201).send(await ai.createProvider(req.owner, req.body)),
  );

  app.put<{ Params: IdParams; Body: ProviderInput }>('/api/ai/providers/:id', { schema: { params: idParams, body: providerBody } }, async (req) =>
    ai.updateProvider(req.owner, req.params.id, req.body),
  );

  app.delete<{ Params: IdParams }>('/api/ai/providers/:id', { schema: { params: idParams } }, async (req, reply) => {
    await ai.deleteProvider(req.owner, req.params.id);
    return reply.code(204).send();
  });

  // The provider's models: also the settings' "Test" (a wrong key or address fails here).
  app.get<{ Params: IdParams }>('/api/ai/providers/:id/models', { schema: { params: idParams } }, async (req) => ai.models(req.owner, req.params.id));

  app.get('/api/ai/tasks', async (req) => ai.taskModels(req.owner));

  app.put<{ Body: Partial<TaskModels> }>('/api/ai/tasks', { schema: { body: tasksBody } }, async (req) => ai.setTaskModels(req.owner, req.body));

  app.get('/api/ai/usage', async (req) => ai.usage(req.owner));

  app.post<{ Params: { id: string }; Body: AskBody }>('/api/tickets/:id/ai', { schema: { params: ticketParams, body: askBody } }, async (req, reply) => {
    const { task, question } = req.body;
    if (task === 'question' && !question?.trim()) throw badRequest('Required', 'question');
    const thread = threadOf(req.body);

    // Everything that can fail as a plain answer comes first: the model, the ticket, what the task needs.
    const chosen = await ai.forTask(req.owner, task);
    const [detail, userSettings] = await Promise.all([tickets.detail(req.owner, req.params.id), settings.get(req.owner)]);
    const similar = task === 'history' ? await tickets.similarClosed(req.owner, detail) : undefined;
    const photos = task === 'photos' ? await tickets.photosForAi(req.owner, req.params.id) : undefined;
    if (task === 'photos' && photos?.length === 0) throw badRequest('This ticket has no photos to look at (signature logos are left out)', 'task');

    // Then the stream: from here on, problems travel as an "error" event.
    const aborted = new AbortController();
    req.raw.on('close', () => aborted.abort());
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    });
    const send = (name: string, data: unknown) => {
      if (!reply.raw.writableEnded) reply.raw.write(event(name, data));
    };
    send('start', { model: chosen.model, provider: chosen.label });
    if (similar) send('sources', similar.map((s) => ({ id: s.id, number: s.number, title: s.title, closedAt: s.closedAt })));
    try {
      const result = await chosen.adapter.stream(
        {
          model: chosen.model,
          system: systemPrompt(detail, userSettings.language),
          messages: messagesFor(thread, task, question, { ...(photos ? { photos } : {}), ...(similar ? { similar } : {}) }),
          signal: aborted.signal,
        },
        (text) => send('delta', { text }),
      );
      await ai.recordUsage(req.owner, chosen.kind, task, result).catch((err: unknown) => req.log.warn({ err }, 'AI usage not recorded'));
      send('done', { model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    } catch (error) {
      const failure = error instanceof AiError ? error : new AiError('failed', 'The answer stopped');
      if (!(error instanceof AiError)) req.log.error({ err: error }, 'AI answer failed');
      send('error', { kind: failure.kind, message: failure.message });
    } finally {
      reply.raw.end();
    }
  });
}
