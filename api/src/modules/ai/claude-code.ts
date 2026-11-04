import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Semaphore } from '../crm/client.js';
import { AiError, type Adapter, type ChatRequest, type ChatResult, type ModelInfo } from './adapter.js';

/**
 * Claude Code with the user's own Claude subscription (lenzi, 2026-11-03: "io pago 20 euro al mese";
 * the app's private use, each user their own subscription). The official, unmodified `claude`
 * program runs headless (`-p`), every tool off, no session kept, in an empty home of its own, with
 * the long-lived token its owner made with `claude setup-token` on their own computer (Anthropic's
 * way to use a subscription in one's own automation, as its GitHub Action does). The app never
 * logs anyone into Claude and never reads a token out of a login: the user pastes their own.
 */

/** Claude Code's own model aliases (`claude --help`: "an alias for the latest model"). */
const ALIASES: ModelInfo[] = [
  { id: 'opus', name: 'Opus (latest)', vision: true },
  { id: 'sonnet', name: 'Sonnet (latest)', vision: true },
  { id: 'haiku', name: 'Haiku (latest)', vision: true },
  { id: 'fable', name: 'Fable (latest)', vision: true },
];

/** Each answer is a process: at most this many at once on the server. */
const RUNNING = new Semaphore(2);

/** Claude Code's last event: how the answer went, and its usage. */
interface ResultEvent {
  is_error?: boolean;
  result?: string;
  api_error_status?: number | null;
  usage?: Record<string, number>;
  modelUsage?: Record<string, unknown>;
}

export interface ClaudeCodeOptions {
  /** The command that runs Claude Code (CLAUDE_CODE_BIN; tests: a fake). */
  command?: string[];
  timeoutMs?: number;
}

export class ClaudeCodeAdapter implements Adapter {
  private readonly command: string[];
  private readonly timeoutMs: number;

  constructor(
    private readonly token: string,
    options: ClaudeCodeOptions = {},
  ) {
    this.command = options.command ?? ['claude'];
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  /** The aliases, once the token is shown to work (one tiny answer from Haiku: the settings' Test). */
  async models(): Promise<ModelInfo[]> {
    await this.stream(
      { model: 'haiku', system: 'Reply with exactly one word.', messages: [{ role: 'user', content: [{ type: 'text', text: 'Say OK' }] }] },
      () => undefined,
    );
    return ALIASES;
  }

  async stream(request: ChatRequest, onText: (text: string) => void): Promise<ChatResult> {
    return RUNNING.run(() => this.run(request, onText));
  }

  private async run(request: ChatRequest, onText: (text: string) => void): Promise<ChatResult> {
    // Claude Code takes one user message here: the panel's earlier turns travel inside it, as a transcript.
    const earlier = request.messages.slice(0, -1);
    const last = request.messages.at(-1);
    if (!last) throw new AiError('bad-request', 'Nothing to ask');
    const transcript = earlier
      .map((m) => `${m.role === 'user' ? 'Technician' : 'You'}: ${m.content.map((p) => (p.type === 'text' ? p.text : '(image)')).join('\n')}`)
      .join('\n\n');
    const content = [
      ...(transcript ? [{ type: 'text', text: `Earlier in this conversation:\n\n${transcript}\n\nNow:` }] : []),
      ...last.content.map((p) =>
        p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } },
      ),
    ];

    const home = await mkdtemp(join(tmpdir(), 'vtiger-claude-'));
    const [bin, ...prefix] = this.command;
    const child = spawn(
      bin!,
      [
        ...prefix,
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--model',
        request.model,
        '--tools',
        '',
        '--system-prompt',
        request.system,
        '--no-session-persistence',
        '--strict-mcp-config',
        '--disable-slash-commands',
      ],
      {
        cwd: home,
        // Only this: never the server's own environment (its database password, its keys).
        env: {
          PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          HOME: home,
          LANG: 'C.UTF-8',
          CLAUDE_CODE_OAUTH_TOKEN: this.token,
          DISABLE_AUTOUPDATER: '1',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        // The desktop app on Windows: no console window flashing up for it.
        windowsHide: true,
      },
    );
    const stop = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(stop, this.timeoutMs);
    request.signal?.addEventListener('abort', stop, { once: true });

    // Filled by the stream's handler: a holder, so the compiler sees it may change.
    const seen: { result: ResultEvent | null } = { result: null };
    let model = request.model;
    let stderr = '';
    let buffer = '';
    const handle = (line: string) => {
      if (!line.trim()) return;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
        onText(String(event.event.delta.text ?? ''));
      } else if (event.type === 'assistant' && typeof event.message?.model === 'string') {
        model = event.message.model;
      } else if (event.type === 'result') {
        seen.result = event as ResultEvent;
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });

    const exit = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve(code));
    });
    child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);

    try {
      await exit.catch((error: NodeJS.ErrnoException) => {
        throw new AiError('unreachable', error.code === 'ENOENT' ? 'Claude Code is not installed on the server' : `Claude Code did not start: ${error.message}`);
      });
      handle(buffer);
    } finally {
      clearTimeout(timer);
      await rm(home, { recursive: true, force: true }).catch(() => undefined);
    }

    if (request.signal?.aborted) throw new AiError('failed', 'Stopped');
    const done = seen.result;
    if (!done) {
      const text = stderr.trim().slice(-300);
      if (/auth|login|token|credential|401/i.test(text)) throw new AiError('auth', `Claude Code refused the token: ${text}`);
      throw new AiError('unreachable', `Claude Code stopped without an answer${text ? `: ${text}` : ''}`);
    }
    if (done.is_error) {
      const status = done.api_error_status ?? 0;
      const message = String(done.result ?? 'error').slice(0, 300);
      if (status === 401 || status === 403 || /auth|log ?in|token/i.test(message)) throw new AiError('auth', `Claude Code refused the token: ${message}`);
      if (status === 429 || /limit/i.test(message)) throw new AiError('rate-limit', `The subscription's limit is reached: ${message}`);
      throw new AiError('failed', `Claude Code: ${message}`);
    }
    const usage = done.usage ?? {};
    const answered = Object.keys(done.modelUsage ?? {})[0];
    return {
      model: answered ?? model,
      inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      outputTokens: usage.output_tokens ?? 0,
    };
  }
}
