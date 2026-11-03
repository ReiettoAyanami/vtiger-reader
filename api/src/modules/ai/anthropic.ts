import Anthropic from '@anthropic-ai/sdk';
import { AiError, errorFromStatus, type Adapter, type ChatRequest, type ChatResult, type ModelInfo } from './adapter.js';

/**
 * Models that take Anthropic's server-side fallback (`fallbacks: "default"`): a request one of them
 * declines is answered by the model Anthropic recommends for that kind of refusal, in the same
 * call. Not Haiku (a list there is a 400, and "default" does nothing).
 */
const WITH_FALLBACK = new Set(['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

/** Output room for an answer: the model's own maximum, at most this (a ticket answer is short). */
const MAX_OUTPUT = 16_000;

/** Anthropic's Messages API, through the official SDK. */
export class AnthropicAdapter implements Adapter {
  private readonly client: Anthropic;

  constructor(apiKey: string, options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.client = new Anthropic({
      apiKey,
      maxRetries: 1,
      timeout: options.timeoutMs ?? 120_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async models(): Promise<ModelInfo[]> {
    try {
      const models: ModelInfo[] = [];
      for await (const model of this.client.models.list()) {
        const capabilities = model.capabilities as { image_input?: { supported?: boolean } } | null;
        models.push({ id: model.id, name: model.display_name, vision: capabilities?.image_input?.supported ?? null });
      }
      return models;
    } catch (error) {
      throw toAiError(error);
    }
  }

  async stream(request: ChatRequest, onText: (text: string) => void): Promise<ChatResult> {
    try {
      // The model's own output limit, when the API gives it.
      const info = await this.client.models.retrieve(request.model).catch(() => null);
      const maxTokens = Math.min(info?.max_tokens ?? MAX_OUTPUT, MAX_OUTPUT);
      const stream = this.client.beta.messages.stream(
        {
          model: request.model,
          max_tokens: maxTokens,
          // The rules and the ticket: the same for every question on the ticket, cached.
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages: request.messages.map((m) => ({
            role: m.role,
            content: m.content.map((part) =>
              part.type === 'text'
                ? { type: 'text' as const, text: part.text }
                : { type: 'image' as const, source: { type: 'base64' as const, media_type: part.mediaType, data: part.data } },
            ),
          })),
          ...(WITH_FALLBACK.has(request.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { ...(request.signal ? { signal: request.signal } : {}) },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text);
      }
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') {
        throw new AiError('refused', 'The model declined to answer this request');
      }
      return { model: message.model, inputTokens: inputTokens(message.usage), outputTokens: message.usage.output_tokens };
    } catch (error) {
      throw toAiError(error);
    }
  }
}

/** Every input token billed: uncached, written to the cache, read from it. */
function inputTokens(usage: { input_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): number {
  return usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  // Most specific first: the SDK's typed errors.
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiError('auth', 'Anthropic refused the API key');
  }
  if (error instanceof Anthropic.RateLimitError) return new AiError('rate-limit', 'Anthropic is busy or the quota is used up: try again shortly');
  if (error instanceof Anthropic.NotFoundError) return new AiError('bad-request', 'Anthropic has no such model');
  if (error instanceof Anthropic.APIConnectionError) return new AiError('unreachable', 'Anthropic does not answer');
  if (error instanceof Anthropic.APIError) return errorFromStatus(error.status ?? 0, error.message);
  if (error instanceof Error && error.name === 'AbortError') return new AiError('failed', 'Stopped');
  return new AiError('failed', error instanceof Error ? error.message : String(error));
}
