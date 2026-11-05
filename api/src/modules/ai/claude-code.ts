import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { Semaphore } from '../crm/client.js';
import { AiError, type Adapter, type ChatRequest, type ChatResult, type ModelInfo } from './adapter.js';

/**
 * Claude Code with the user's own Claude subscription, through the login that Claude Code already
 * has on this computer (plan 4.3, 2026-11-05). The app keeps no token and signs nobody in: the
 * official, unmodified `claude` program keeps the login, made by its user in Claude Code. This file
 * never reads a credential. Anthropic's terms let an end user sign in to the unmodified Claude Code
 * binary with their own subscription, and forbid third parties to collect or store such credentials
 * (https://code.claude.com/docs/en/legal-and-compliance). Products are advised to use API keys: this
 * is each user's own use, on their own computer.
 * The program runs headless (`-p`): every tool off, no session kept, no CLAUDE.md, no memory, no
 * hooks from the user's settings, no MCP servers, in an empty working folder of its own.
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

/** How to get Claude Code, said where it is missing: on Windows, Anthropic's native installer. */
function notInstalled(): string {
  const how = process.platform === 'win32' ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash';
  return `Claude Code is not installed on this computer. Install it (${how}), run claude once to sign in, then save again`;
}

/**
 * The program to run. On Windows the native installer puts claude.exe in %USERPROFILE%\.local\bin,
 * and does not always add that folder to PATH (Anthropic's troubleshooting page): when the bare name
 * is not on PATH, that file is used. A npm install makes a claude.cmd, which a program cannot start
 * without a shell, so it is not looked for.
 */
export function resolveCommand(
  command: string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
  home: string = homedir(),
): string[] {
  const [bin, ...rest] = command;
  if (bin !== 'claude' || platform !== 'win32') return command;
  const paths = win32;
  const onPath = (env.PATH ?? env.Path ?? '').split(';').some((dir) => dir !== '' && exists(paths.join(dir, 'claude.exe')));
  if (onPath) return command;
  const native = paths.join(home, '.local', 'bin', 'claude.exe');
  return exists(native) ? [native, ...rest] : command;
}

/** What a user needs to hear when Claude Code has no usable login on this computer. */
const SIGN_IN =
  'Claude Code is not signed in on this computer, or its sign-in expired: open Claude Code, sign in with your Claude account, then try again';

/**
 * What the program gets from this process: what it needs to run, and to find the login in the home
 * folder (HOME, USERPROFILE). Never the server's own secrets: its database password, its keys.
 */
const INHERITED = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'USERDOMAIN',
  'LOGONSERVER',
  'WINDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'USER',
] as const;

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    ...env,
    // An answer, not a session: no CLAUDE.md, no memory written, no updater, no extra traffic.
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
  };
}

/** Claude Code's last event: how the answer went, and its usage. */
interface ResultEvent {
  is_error?: boolean;
  result?: string;
  api_error_status?: number | null;
  usage?: Record<string, number>;
  modelUsage?: Record<string, unknown>;
}

/** Whether Claude Code has a login on this computer, and which plan it is. */
export interface ClaudeCodeStatus {
  loggedIn: boolean;
  /** The plan of the login ("pro", "max"...), as Claude Code names it. */
  plan: string | null;
}

/**
 * Whether Claude Code is signed in on this computer: its own `auth status`, read from its own record
 * of the login. No model is asked, and the app reads no credential.
 */
export async function claudeCodeStatus(command: string[] = ['claude'], timeoutMs = 30_000): Promise<ClaudeCodeStatus> {
  const workdir = await mkdtemp(join(tmpdir(), 'vtiger-claude-'));
  try {
    const [bin, ...prefix] = resolveCommand(command);
    const out = await capture(bin!, [...prefix, 'auth', 'status', '--json'], workdir, timeoutMs);
    let parsed: { loggedIn?: unknown; subscriptionType?: unknown };
    try {
      parsed = JSON.parse(out);
    } catch {
      // Not its JSON: it did not say that it is signed in.
      return { loggedIn: false, plan: null };
    }
    return {
      loggedIn: parsed.loggedIn === true,
      plan: typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : null,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The program's standard output, once it ends. A program that is not installed is said so. */
function capture(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (out += chunk));
    child.stderr.resume();
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new AiError(
          'unreachable',
          error.code === 'ENOENT' ? notInstalled() : `Claude Code did not start: ${error.message}`,
        ),
      );
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out.trim());
    });
  });
}

export interface ClaudeCodeOptions {
  /** The command that runs Claude Code (CLAUDE_CODE_BIN; tests: a fake). */
  command?: string[];
  timeoutMs?: number;
}

export class ClaudeCodeAdapter implements Adapter {
  private readonly command: string[];
  private readonly timeoutMs: number;

  constructor(options: ClaudeCodeOptions = {}) {
    this.command = options.command ?? ['claude'];
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  /** The aliases, once Claude Code answers (one tiny answer from Haiku: the settings' Test). */
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

    const workdir = await mkdtemp(join(tmpdir(), 'vtiger-claude-'));
    const [bin, ...prefix] = resolveCommand(this.command);
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
        // Not the hooks of the user's own settings: the answer is the app's, not the user's session.
        '--setting-sources',
        'local',
      ],
      {
        cwd: workdir,
        env: childEnv(),
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
        throw new AiError(
          'unreachable',
          error.code === 'ENOENT' ? notInstalled() : `Claude Code did not start: ${error.message}`,
        );
      });
      handle(buffer);
    } finally {
      clearTimeout(timer);
      await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    }

    if (request.signal?.aborted) throw new AiError('failed', 'Stopped');
    const done = seen.result;
    if (!done) {
      const text = stderr.trim().slice(-300);
      if (/auth|login|log in|credential|401/i.test(text)) throw new AiError('auth', `${SIGN_IN}. ${text}`);
      throw new AiError('unreachable', `Claude Code stopped without an answer${text ? `: ${text}` : ''}`);
    }
    if (done.is_error) {
      const status = done.api_error_status ?? 0;
      const message = String(done.result ?? 'error').slice(0, 300);
      if (status === 401 || status === 403 || /auth|log ?in/i.test(message)) throw new AiError('auth', `${SIGN_IN}. ${message}`);
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
