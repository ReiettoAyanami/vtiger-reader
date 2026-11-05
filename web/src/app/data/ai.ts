/** The AI help (api/src/modules/ai): each user's providers, which model does what, usage, the panel. */

export const PROVIDER_KINDS = [
  { kind: 'anthropic', name: 'Anthropic (Claude)', needsUrl: false, needsKey: true },
  { kind: 'openai', name: 'OpenAI', needsUrl: false, needsKey: true },
  { kind: 'gemini', name: 'Google Gemini', needsUrl: false, needsKey: true },
  {
    kind: 'openai-compatible',
    name: 'OpenAI-compatible (Regolo, OpenRouter, DeepSeek…)',
    needsUrl: true,
    needsKey: true,
  },
  { kind: 'ollama', name: 'Ollama', needsUrl: true, needsKey: false },
  {
    kind: 'claude-code',
    name: 'Claude Code (your Pro/Max subscription)',
    needsUrl: false,
    needsKey: false,
  },
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number]['kind'];

export interface Provider {
  id: number;
  kind: ProviderKind;
  label: string;
  baseUrl: string | null;
  hasKey: boolean;
  /** The key's last characters ("…1234"); the key itself never comes back. */
  keyHint: string | null;
}

export interface ProviderInput {
  kind: ProviderKind;
  label: string;
  baseUrl?: string | null;
  /** Omitted on an edit: the saved key stays. */
  apiKey?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  /** Whether it reads images; null when the provider does not say. */
  vision: boolean | null;
}

export const TASKS = [
  { task: 'summary', label: 'Summarize it', chip: 'Summarize it' },
  { task: 'reply', label: 'Draft the reply', chip: 'Draft the reply' },
  { task: 'photos', label: 'Look at the photos', chip: 'Look at the photos' },
  { task: 'history', label: 'Has this happened before?', chip: 'Has this happened before?' },
  { task: 'question', label: 'Other questions', chip: 'Other question…' },
] as const;

export type Task = (typeof TASKS)[number]['task'];
export type TaskSlot = 'default' | Task;

export type TaskModels = Record<TaskSlot, { providerId: number; model: string } | null>;

export interface UsageRow {
  day: string;
  kind: string;
  model: string;
  task: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

/** A turn of the panel's thread: kept by the page only, gone when the panel closes. */
export type ThreadTurn =
  { role: 'user'; task: Task; question?: string } | { role: 'assistant'; text: string };

export interface SimilarSource {
  id: string;
  number: string;
  title: string;
  closedAt: string | null;
}

/** The events of an answer, as the API streams them. */
export type AskEvent =
  | { event: 'start'; data: { model: string; provider: string } }
  | { event: 'sources'; data: SimilarSource[] }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { model: string; inputTokens: number; outputTokens: number } }
  | { event: 'error'; data: { kind: string; message: string } };
