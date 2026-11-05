import type { Database } from '../../db/database.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import type { Owner } from '../../shared/owner.js';
import { isPublicHost } from '../../shared/public-host.js';
import type { SecretBox } from '../../shared/secret-box.js';
import {
  AiError,
  KINDS_WITH_URL,
  KINDS_WITHOUT_KEY,
  PROVIDER_KINDS,
  type Adapter,
  type ChatResult,
  type ModelInfo,
  type ProviderKind,
} from './adapter.js';
import { AnthropicAdapter } from './anthropic.js';
import { ClaudeCodeAdapter, claudeCodeStatus } from './claude-code.js';
import { OpenAiAdapter } from './openai.js';
import * as repo from './repository.js';

/** The tasks of the AI panel (plan 4.2), each with a model of its own or the default one. */
export const TASKS = ['summary', 'reply', 'photos', 'history', 'question'] as const;
export type Task = (typeof TASKS)[number];
export const TASK_SLOTS = ['default', ...TASKS] as const;
export type TaskSlot = (typeof TASK_SLOTS)[number];

/** The fixed addresses of the kinds that have one (OpenAI-style APIs). */
const FIXED_URL: Partial<Record<ProviderKind, string>> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

/** A provider as the browser sees it: never its key, only its last characters. */
export interface ProviderView {
  id: number;
  kind: ProviderKind;
  label: string;
  baseUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
}

export interface ProviderInput {
  kind: ProviderKind;
  label: string;
  baseUrl?: string | null;
  /** A new key; omitted on an update: the saved one stays. '' removes it (Ollama). */
  apiKey?: string;
}

export type TaskModels = Record<TaskSlot, { providerId: number; model: string } | null>;

export interface AiOptions {
  privateHosts: string[];
  /** How Claude Code is run (CLAUDE_CODE_BIN, split on spaces; tests: a fake). */
  claudeCode?: string[];
  fetch?: typeof fetch;
  hostAllowed?: (host: string) => Promise<boolean>;
  /**
   * The desktop app (plan 7.4): any address, http too (a local Ollama). Its only user is the PC's
   * owner, who cannot reach through it anything they could not reach anyway.
   */
  anyAddress?: boolean;
}

/** The key's context: the table and the user, so a sealed key copied to another user does not open. */
function keyContext(owner: Owner): string {
  return `ai_provider:${owner.userId}`;
}

/** The last 4 characters, to tell keys apart in the settings. */
function hintOf(key: string): string {
  return key.length >= 12 ? `…${key.slice(-4)}` : '…';
}

/**
 * Each user's AI providers and choices (plan 4.1, 4.2, 4.7). The addresses a provider calls are
 * https on the public internet, or one of AI_PRIVATE_HOSTS (a local Ollama): checked when saved
 * and again before every call, since a name can be pointed elsewhere afterwards.
 */
export class AiService {
  private readonly privateHosts: Set<string>;
  private readonly hostAllowed: (host: string) => Promise<boolean>;

  constructor(
    private readonly pool: Database,
    private readonly box: SecretBox,
    private readonly options: AiOptions,
  ) {
    this.privateHosts = new Set(options.privateHosts.map((h) => h.toLowerCase()));
    this.hostAllowed = options.hostAllowed ?? isPublicHost;
  }

  // Providers.

  async providers(owner: Owner): Promise<ProviderView[]> {
    return (await repo.listProviders(this.pool, owner)).map((p) => this.view(p));
  }

  private view(p: repo.ProviderRow): ProviderView {
    return { id: p.id, kind: p.kind, label: p.label, baseUrl: p.baseUrl, hasKey: p.keySealed !== null, keyHint: p.keyHint };
  }

  private async row(owner: Owner, id: number): Promise<repo.ProviderRow> {
    const row = await repo.findProvider(this.pool, owner, id);
    if (!row) throw notFound('Provider', id);
    return row;
  }

  async createProvider(owner: Owner, input: ProviderInput): Promise<ProviderView> {
    const { label, baseUrl } = await this.checked(input);
    const key = (input.apiKey ?? '').trim();
    if (input.kind === 'claude-code') await this.signedIn(key);
    if (!key && !KINDS_WITHOUT_KEY.has(input.kind)) throw badRequest('Required', 'apiKey');
    if ((await repo.listProviders(this.pool, owner)).length >= 20) throw badRequest('At most 20 providers');
    const id = await repo.insertProvider(this.pool, owner, {
      kind: input.kind,
      label,
      baseUrl,
      keySealed: key ? this.box.seal(key, keyContext(owner)) : null,
      keyHint: key ? hintOf(key) : null,
    });
    return this.view(await this.row(owner, id));
  }

  async updateProvider(owner: Owner, id: number, input: ProviderInput): Promise<ProviderView> {
    const current = await this.row(owner, id);
    if (input.kind !== current.kind) throw badRequest('The kind of a provider does not change: add a new one', 'kind');
    if (input.kind === 'claude-code' && (input.apiKey ?? '').trim()) throw badRequest('Claude Code uses the login of this computer: it takes no key', 'apiKey');
    const { label, baseUrl } = await this.checked(input);
    let key: { sealed: string | null; hint: string | null } | undefined;
    if (input.apiKey !== undefined) {
      const given = input.apiKey.trim();
      if (!given && !KINDS_WITHOUT_KEY.has(input.kind)) throw badRequest('Required', 'apiKey');
      key = given ? { sealed: this.box.seal(given, keyContext(owner)), hint: hintOf(given) } : { sealed: null, hint: null };
    }
    await repo.updateProvider(this.pool, owner, id, { label, baseUrl, ...(key ? { key } : {}) });
    return this.view(await this.row(owner, id));
  }

  /** Claude Code keeps its own login on this computer: the app takes no key for it, and needs that login. */
  private async signedIn(key: string): Promise<void> {
    if (key) throw badRequest('Claude Code uses the login of this computer: it takes no key', 'apiKey');
    const status = await claudeCodeStatus(this.options.claudeCode);
    if (!status.loggedIn) {
      throw conflict(
        'claude-code-signed-out',
        'Claude Code is not signed in on this computer: open Claude Code, sign in with your Claude account, then save again',
      );
    }
  }

  async deleteProvider(owner: Owner, id: number): Promise<void> {
    if (!(await repo.deleteProvider(this.pool, owner, id))) throw notFound('Provider', id);
  }

  /** The models the provider offers, read from it (also the "Test" of the settings). */
  async models(owner: Owner, id: number): Promise<ModelInfo[]> {
    return (await this.adapter(owner, await this.row(owner, id))).models();
  }

  private async checked(input: ProviderInput): Promise<{ label: string; baseUrl: string | null }> {
    if (!(PROVIDER_KINDS as readonly string[]).includes(input.kind)) throw badRequest('Not a provider kind', 'kind');
    const label = input.label.trim().replace(/\s+/g, ' ');
    if (!label) throw badRequest('Required', 'label');
    if (!KINDS_WITH_URL.has(input.kind)) return { label, baseUrl: null };
    const baseUrl = this.baseUrlOf(input.kind, input.baseUrl ?? '');
    if (!baseUrl) throw badRequest('An address such as https://api.example.com/v1', 'baseUrl');
    if (!(await this.reachable(baseUrl))) {
      throw badRequest('Not a public https address: the server only calls providers on the internet (or AI_PRIVATE_HOSTS)', 'baseUrl');
    }
    return { label, baseUrl };
  }

  /** The provider's address as stored: no trailing slash; Ollama's root (its /v1 is added when called). */
  private baseUrlOf(kind: ProviderKind, raw: string): string | null {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      return null;
    }
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    let path = url.pathname.replace(/\/+$/, '');
    if (kind === 'ollama') path = path.replace(/\/v1$/, '');
    return `${url.origin}${path}`;
  }

  /** https on a public host; or any scheme on a host the instance lists in AI_PRIVATE_HOSTS. */
  private async reachable(baseUrl: string): Promise<boolean> {
    if (this.options.anyAddress) return true;
    const url = new URL(baseUrl);
    if (this.privateHosts.has(url.host.toLowerCase()) || this.privateHosts.has(url.hostname.toLowerCase())) return true;
    return url.protocol === 'https:' && (await this.hostAllowed(url.hostname));
  }

  private async adapter(owner: Owner, p: repo.ProviderRow): Promise<Adapter> {
    const key = p.keySealed ? this.box.open(p.keySealed, keyContext(owner)) : null;
    if (p.keySealed && key === null) {
      throw conflict('ai-key-unreadable', `The key of "${p.label}" can no longer be read (the server's encryption key changed): enter it again`);
    }
    const http = this.options.fetch ? { fetch: this.options.fetch } : {};
    if (p.kind === 'anthropic') return new AnthropicAdapter(key ?? '', http);
    if (p.kind === 'claude-code') return new ClaudeCodeAdapter(this.options.claudeCode ? { command: this.options.claudeCode } : {});
    const base = p.kind === 'ollama' ? `${p.baseUrl}/v1` : (FIXED_URL[p.kind] ?? p.baseUrl ?? '');
    if (!(await this.reachable(base))) throw new AiError('address', `The address of "${p.label}" is not a public https address any more`);
    return new OpenAiAdapter(base, key, http);
  }

  // Which model does what.

  async taskModels(owner: Owner): Promise<TaskModels> {
    const rows = await repo.listTaskModels(this.pool, owner);
    return Object.fromEntries(
      TASK_SLOTS.map((slot) => {
        const row = rows.find((r) => r.task === slot);
        return [slot, row ? { providerId: row.providerId, model: row.model } : null];
      }),
    ) as TaskModels;
  }

  async setTaskModels(owner: Owner, patch: Partial<TaskModels>): Promise<TaskModels> {
    const providers = new Set((await repo.listProviders(this.pool, owner)).map((p) => p.id));
    for (const [slot, choice] of Object.entries(patch)) {
      if (!(TASK_SLOTS as readonly string[]).includes(slot)) throw badRequest(`No task "${slot}"`, slot);
      if (choice === null || choice === undefined) {
        await repo.clearTaskModel(this.pool, owner, slot);
        continue;
      }
      if (!providers.has(choice.providerId)) throw badRequest('Not one of your providers', `${slot}.providerId`);
      const model = choice.model.trim();
      if (!model) throw badRequest('Required', `${slot}.model`);
      await repo.setTaskModel(this.pool, owner, slot, choice.providerId, model);
    }
    return this.taskModels(owner);
  }

  /** The adapter and model for a task: its own, else the default; 409 when the user has none. */
  async forTask(owner: Owner, task: Task): Promise<{ adapter: Adapter; kind: ProviderKind; model: string; label: string }> {
    const models = await this.taskModels(owner);
    const choice = models[task] ?? models.default;
    if (!choice) throw conflict('ai-not-configured', 'No AI model is set up: add a provider and choose a model in Settings');
    const provider = await this.row(owner, choice.providerId).catch(() => {
      throw conflict('ai-not-configured', 'The provider chosen for this task is gone: choose another in Settings');
    });
    return { adapter: await this.adapter(owner, provider), kind: provider.kind, model: choice.model, label: provider.label };
  }

  // Usage.

  async recordUsage(owner: Owner, kind: ProviderKind, task: Task, result: ChatResult, now = new Date()): Promise<void> {
    await repo.addUsage(this.pool, owner, {
      day: now.toISOString().slice(0, 10),
      kind,
      model: result.model,
      task,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
    });
  }

  /** The last 30 days, per day, model and task. */
  async usage(owner: Owner, now = new Date()): Promise<repo.UsageRow[]> {
    const since = new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
    return repo.usageSince(this.pool, owner, since);
  }
}
