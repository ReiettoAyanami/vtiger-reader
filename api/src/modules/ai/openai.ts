import { AiError, errorFromStatus, type Adapter, type ChatRequest, type ChatResult, type ModelInfo } from './adapter.js';

/**
 * The OpenAI-style chat completions (`POST <base>/chat/completions`, streamed as server-sent
 * events): OpenAI itself, Google Gemini's compatible endpoint, Ollama's `/v1`, and any service that
 * speaks it (Regolo, OpenRouter, DeepSeek...).
 */
export class OpenAiAdapter implements Adapter {
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    /** e.g. https://api.openai.com/v1, without a trailing slash */
    private readonly baseUrl: string,
    private readonly apiKey: string | null,
    options: { fetch?: typeof fetch; timeoutMs?: number } = {},
  ) {
    this.fetch = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) };
  }

  async models(): Promise<ModelInfo[]> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}/models`, { headers: this.headers(), signal: AbortSignal.timeout(20_000), redirect: 'error' });
    } catch {
      throw new AiError('unreachable', 'The provider does not answer');
    }
    if (!response.ok) throw errorFromStatus(response.status, await response.text().catch(() => ''));
    const body = (await response.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null;
    return (body?.data ?? [])
      .flatMap((m) => (typeof m.id === 'string' ? [{ id: m.id.replace(/^models\//, ''), name: m.id.replace(/^models\//, ''), vision: null }] : []))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async stream(request: ChatRequest, onText: (text: string) => void): Promise<ChatResult> {
    const messages = [
      { role: 'system', content: request.system },
      ...request.messages.map((m) => ({
        role: m.role,
        content: m.content.every((p) => p.type === 'text')
          ? m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n\n')
          : m.content.map((p) =>
              p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } },
            ),
      })),
    ];
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: request.model, messages, stream: true, stream_options: { include_usage: true } }),
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (request.signal?.aborted) throw new AiError('failed', 'Stopped');
      throw new AiError('unreachable', error instanceof Error && error.name === 'TimeoutError' ? 'The provider took too long' : 'The provider does not answer');
    }
    if (!response.ok || !response.body) throw errorFromStatus(response.status, await response.text().catch(() => ''));

    const result: ChatResult = { model: request.model, inputTokens: 0, outputTokens: 0 };
    let refused = false;
    const decoder = new TextDecoder();
    let buffer = '';
    const handle = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let chunk: {
        model?: string;
        error?: { message?: string };
        choices?: Array<{ delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      if (chunk.error) throw new AiError('failed', `The provider stopped: ${chunk.error.message ?? 'error'}`);
      if (typeof chunk.model === 'string' && chunk.model) result.model = chunk.model;
      for (const choice of chunk.choices ?? []) {
        if (choice.delta?.content) onText(choice.delta.content);
        if (choice.delta?.refusal || choice.finish_reason === 'content_filter') refused = true;
      }
      if (chunk.usage) {
        result.inputTokens = chunk.usage.prompt_tokens ?? result.inputTokens;
        result.outputTokens = chunk.usage.completion_tokens ?? result.outputTokens;
      }
    };
    try {
      for await (const piece of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(piece, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          handle(buffer.slice(0, newline).replace(/\r$/, ''));
          buffer = buffer.slice(newline + 1);
        }
      }
      handle(buffer);
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (request.signal?.aborted) throw new AiError('failed', 'Stopped');
      throw new AiError('unreachable', 'The provider stopped answering');
    }
    if (refused) throw new AiError('refused', 'The model declined to answer this request');
    return result;
  }
}
