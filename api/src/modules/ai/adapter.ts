/**
 * What every AI provider does for the app (plan 4.3): list its models, and stream one answer. Two
 * adapters cover every kind: Anthropic's Messages API (anthropic.ts, the official SDK) and the
 * OpenAI-style chat completions that OpenAI, Gemini, Ollama and the "compatible" services expose
 * (openai.ts).
 */

export const PROVIDER_KINDS = ['anthropic', 'openai', 'gemini', 'openai-compatible', 'ollama'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** The kinds whose address the user gives; the others have a fixed one. */
export const KINDS_WITH_URL: ReadonlySet<ProviderKind> = new Set(['openai-compatible', 'ollama']);
/** The kinds that work without an API key (a local Ollama). */
export const KINDS_WITHOUT_KEY: ReadonlySet<ProviderKind> = new Set(['ollama']);

export type Part = { type: 'text'; text: string } | { type: 'image'; mediaType: 'image/jpeg'; data: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: Part[];
}

export interface ChatRequest {
  model: string;
  /** Stable first (the rules, the ticket): providers that cache a prefix reuse it for follow-ups. */
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export interface ModelInfo {
  id: string;
  name: string;
  /** Whether it reads images; null when the provider does not say. */
  vision: boolean | null;
}

export interface ChatResult {
  /** The model that answered (a fallback may answer for the one asked). */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Adapter {
  models(): Promise<ModelInfo[]>;
  stream(request: ChatRequest, onText: (text: string) => void): Promise<ChatResult>;
}

/**
 * What went wrong with a provider, in the terms the page needs:
 * auth (a wrong or revoked key), unreachable (no answer), rate-limit, refused (the model declined),
 * bad-request (a model it does not have, an image it cannot read), address (not allowed), failed.
 */
export type AiErrorKind = 'auth' | 'unreachable' | 'rate-limit' | 'refused' | 'bad-request' | 'address' | 'failed';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** An HTTP status of a provider as an AiError. */
export function errorFromStatus(status: number, detail: string): AiError {
  const text = detail.trim().slice(0, 300) || `HTTP ${status}`;
  if (status === 401 || status === 403) return new AiError('auth', `The provider refused the key: ${text}`);
  if (status === 429) return new AiError('rate-limit', `The provider is busy or the quota is used up: ${text}`);
  if (status === 400 || status === 404 || status === 422) return new AiError('bad-request', `The provider refused the request: ${text}`);
  if (status >= 500) return new AiError('unreachable', `The provider has a problem (${status}): ${text}`);
  return new AiError('failed', `The provider answered ${status}: ${text}`);
}
