/**
 * AI providers in memory, answering as the real ones do: an OpenAI-style service (models, streamed
 * chat completions) and Anthropic's API (models, streamed Messages events, as the official SDK reads
 * them). They record what they are sent, to see what left the server.
 */

export interface SentRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function sse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function headersOf(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => (out[key] = value));
  return out;
}

export class FakeOpenAi {
  readonly base = 'https://ai.example.invalid/v1';
  readonly sent: SentRequest[] = [];
  key = 'sk-test-0000000000001234';
  answer = ['Il cliente ', 'non riesce ', 'a stampare.'];
  refuse = false;
  down = false;

  readonly fetch: typeof fetch = async (input, init) => {
    if (this.down) throw new TypeError('fetch failed');
    const url = String(input instanceof Request ? input.url : input);
    const request: SentRequest = { url, method: init?.method ?? 'GET', headers: headersOf(init), body: init?.body ? JSON.parse(String(init.body)) : null };
    this.sent.push(request);
    if (request.headers['authorization'] !== `Bearer ${this.key}`) {
      return Response.json({ error: { message: 'Incorrect API key provided' } }, { status: 401 });
    }
    if (url === `${this.base}/models`) return Response.json({ object: 'list', data: [{ id: 'model-b' }, { id: 'model-a' }] });
    if (url === `${this.base}/chat/completions`) {
      const chunks = this.answer.map((text) => `data: ${JSON.stringify({ model: request.body.model, choices: [{ delta: { content: text } }] })}\n\n`);
      if (this.refuse) chunks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'content_filter' }] })}\n\n`);
      chunks.push(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 321, completion_tokens: 12 } })}\n\n`, 'data: [DONE]\n\n');
      return sse(chunks);
    }
    return Response.json({ error: { message: 'not found' } }, { status: 404 });
  };
}

export class FakeAnthropic {
  readonly sent: SentRequest[] = [];
  key = 'sk-ant-test-000000005678';
  answer = ['Riassunto: ', 'la stampante è ferma.'];
  stopReason: 'end_turn' | 'refusal' = 'end_turn';

  private model(id: string, vision = true) {
    return {
      type: 'model',
      id,
      display_name: id.replace('claude-', 'Claude ').replace(/-/g, ' '),
      created_at: '2026-10-01T00:00:00Z',
      max_input_tokens: 1000000,
      max_tokens: 128000,
      capabilities: { image_input: { supported: vision } },
    };
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const request: SentRequest = { url: url.toString(), method: init?.method ?? 'GET', headers: headersOf(init), body: init?.body ? JSON.parse(String(init.body)) : null };
    this.sent.push(request);
    if (request.headers['x-api-key'] !== this.key) {
      return Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 });
    }
    if (url.pathname === '/v1/models') {
      const data = [this.model('claude-opus-5-5'), this.model('claude-haiku-5-5')];
      return Response.json({ data, has_more: false, first_id: data[0]!.id, last_id: data[1]!.id });
    }
    if (url.pathname.startsWith('/v1/models/')) return Response.json(this.model(url.pathname.slice('/v1/models/'.length)));
    if (url.pathname === '/v1/messages') {
      const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
      return sse([
        event('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: request.body.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 20, cache_read_input_tokens: 0 },
          },
        }),
        event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
        ...this.answer.map((text) => event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
        event('content_block_stop', { type: 'content_block_stop', index: 0 }),
        event('message_delta', { type: 'message_delta', delta: { stop_reason: this.stopReason, stop_sequence: null }, usage: { output_tokens: 15 } }),
        event('message_stop', { type: 'message_stop' }),
      ]);
    }
    return Response.json({ type: 'error', error: { type: 'not_found_error', message: 'not found' } }, { status: 404 });
  };
}
