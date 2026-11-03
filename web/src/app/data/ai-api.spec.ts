import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { AskEvent } from './ai';
import { AiApi, parseEvents } from './ai-api';

describe('parseEvents', () => {
  it('whole events out, the half one kept for the next chunk', () => {
    const { events, rest } = parseEvents(
      'event: delta\ndata: {"text":"Ciao"}\n\nevent: delta\ndata: {"text":" mon',
    );
    expect(events).toEqual([{ event: 'delta', data: { text: 'Ciao' } }]);
    expect(rest).toBe('event: delta\ndata: {"text":" mon');
  });
});

describe('AiApi', () => {
  let api: AiApi;
  let backend: HttpTestingController;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(AiApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    backend.verify();
    globalThis.fetch = realFetch;
  });

  it('providers, models, tasks, usage', async () => {
    void firstValueFrom(api.providers());
    backend.expectOne({ method: 'GET', url: '/api/ai/providers' }).flush([]);
    void firstValueFrom(api.createProvider({ kind: 'anthropic', label: 'Claude', apiKey: 'k' }));
    expect(backend.expectOne({ method: 'POST', url: '/api/ai/providers' }).request.body).toEqual({
      kind: 'anthropic',
      label: 'Claude',
      apiKey: 'k',
    });
    void firstValueFrom(api.models(3));
    backend.expectOne({ method: 'GET', url: '/api/ai/providers/3/models' }).flush([]);
    void firstValueFrom(api.setTasks({ default: { providerId: 3, model: 'm' } }));
    backend.expectOne({ method: 'PUT', url: '/api/ai/tasks' }).flush({});
    void firstValueFrom(api.usage());
    backend.expectOne({ method: 'GET', url: '/api/ai/usage' }).flush([]);
  });

  it('asks: the events as they stream in, split anywhere', async () => {
    const chunks = [
      'event: start\ndata: {"model":"m","provider":"P"}\n\nevent: delta\ndata: {"te',
      'xt":"Ciao"}\n\nevent: done\ndata: {"model":"m","inputTokens":1,"outputTokens":2}\n\n',
    ];
    let sent: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = init;
      const body = new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    const events: AskEvent[] = [];
    await api.ask(
      '17x1',
      { task: 'summary', thread: [] },
      (e) => events.push(e),
      new AbortController().signal,
    );
    expect(events.map((e) => e.event)).toEqual(['start', 'delta', 'done']);
    expect(JSON.parse(String(sent?.body))).toEqual({ task: 'summary', thread: [] });
  });

  it('a request refused before any answer: the API problem, as an error', async () => {
    globalThis.fetch = (async () =>
      Response.json(
        {
          type: 'urn:vtiger-reader:problem:ai-not-configured',
          title: 'Conflict',
          status: 409,
          detail: 'No AI model is set up',
          errors: [],
        },
        { status: 409 },
      )) as typeof fetch;
    const error = await api
      .ask('17x1', { task: 'summary', thread: [] }, () => undefined, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 409,
      code: 'ai-not-configured',
      detail: 'No AI model is set up',
    });
  });
});
