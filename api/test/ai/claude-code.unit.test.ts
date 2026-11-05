import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AiError, type ChatRequest } from '../../src/modules/ai/adapter.js';
import { ClaudeCodeAdapter, claudeCodeStatus, resolveCommand } from '../../src/modules/ai/claude-code.js';

const FAKE_PATH = fileURLToPath(new URL('../support/fake-claude.mjs', import.meta.url));
/** The fake, in one of its modes (see fake-claude.mjs). */
const fake = (mode: string) => ['node', FAKE_PATH, mode];

const request: ChatRequest = {
  model: 'sonnet',
  system: 'rules and <ticket>…</ticket>',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Summarize it' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'A printer is stuck.' }] },
    { role: 'user', content: [{ type: 'image', mediaType: 'image/jpeg', data: 'AAAA' }, { type: 'text', text: 'Look at the photos' }] },
  ],
};

async function ask(mode: string, req: ChatRequest = request) {
  let text = '';
  const result = await new ClaudeCodeAdapter({ command: fake(mode) }).stream(req, (t) => (text += t));
  return { result, seen: JSON.parse(text) as { args: string[]; env: string[]; home: string | null; input: any } };
}

async function failure(promise: Promise<unknown>): Promise<AiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiError);
  return error as AiError;
}

/** What Windows gives every child process, whatever its environment (libuv's required variables). */
const WINDOWS_REQUIRED = ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR'];

describe('Claude Code adapter (the login of this computer, no token)', () => {
  it('runs Claude Code headless, every tool off, no settings of the user; streams the answer; counts every token', async () => {
    const { result, seen } = await ask('ok');
    expect(seen.args).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model',
      'sonnet',
      '--tools',
      '',
      '--system-prompt',
      'rules and <ticket>…</ticket>',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--setting-sources',
      'local',
    ]);
    expect(result).toEqual({ model: 'claude-sonnet-9', inputTokens: 110, outputTokens: 20 });
  });

  it('keeps the login’s folder (HOME) and no token; nothing of the server’s secrets or of an API key', async () => {
    process.env.DB_PASSWORD = 'server-secret';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api-test';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test';
    try {
      const { seen } = await ask('ok');
      expect(seen.home).toBe(process.env.HOME ?? process.env.USERPROFILE ?? null);
      expect(seen.env).toEqual(expect.arrayContaining(['CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_DISABLE_CLAUDE_MDS', 'DISABLE_AUTOUPDATER', 'PATH']));
      expect(seen.env).not.toContain('DB_PASSWORD');
      expect(seen.env).not.toContain('ANTHROPIC_API_KEY');
      expect(seen.env).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
      // On Windows the system adds what every program needs (libuv's required variables): not ours.
      const system = process.platform === 'win32' ? WINDOWS_REQUIRED : [];
      const allowed = [
        'APPDATA',
        'AUTO_MEMORY',
        'CLAUDE_CODE_DISABLE_CLAUDE_MDS',
        'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
        'DISABLE_AUTOUPDATER',
        'HOME',
        'LANG',
        'LC_ALL',
        'LOCALAPPDATA',
        'PATH',
        'SYSTEMROOT',
        'TEMP',
        'TMP',
        'USER',
        'USERNAME',
        'USERPROFILE',
      ];
      expect(seen.env.filter((name) => !system.includes(name)).every((name) => allowed.includes(name))).toBe(true);
      expect(seen.args.join(' ')).not.toContain('sk-ant');
    } finally {
      delete process.env.DB_PASSWORD;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }
  });

  it('one user message: the earlier turns as a transcript, then the photos and the request', async () => {
    const { seen } = await ask('ok');
    expect(seen.input.type).toBe('user');
    expect(seen.input.message.content).toEqual([
      { type: 'text', text: 'Earlier in this conversation:\n\nTechnician: Summarize it\n\nYou: A printer is stuck.\n\nNow:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      { type: 'text', text: 'Look at the photos' },
    ]);
  });

  it('not signed in, the subscription’s limit, a crash, no program: each its kind and its words', async () => {
    const refused = await failure(ask('refuse'));
    expect(refused.kind).toBe('auth');
    expect(refused.message).toContain('not signed in on this computer');
    expect((await failure(ask('limit'))).kind).toBe('rate-limit');
    expect((await failure(ask('crash'))).kind).toBe('unreachable');
    const missing = new ClaudeCodeAdapter({ command: ['/nonexistent/claude'] }).stream(request, () => undefined);
    expect((await failure(missing)).message).toContain('Claude Code is not installed on this computer');
  });

  it('the Test: a tiny answer from Haiku, then the aliases; not signed in: refused', async () => {
    expect((await new ClaudeCodeAdapter({ command: fake('ok') }).models()).map((m) => m.id)).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
    await expect(new ClaudeCodeAdapter({ command: fake('refuse') }).models()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('the login’s status: signed in with its plan, or not; no program: said so', async () => {
    expect(await claudeCodeStatus(fake('ok'))).toEqual({ loggedIn: true, plan: 'pro' });
    expect(await claudeCodeStatus(fake('signed-out'))).toEqual({ loggedIn: false, plan: null });
    expect((await failure(claudeCodeStatus(['/nonexistent/claude']))).message).toContain('Claude Code is not installed on this computer');
  });
});

describe('finding Claude Code on Windows', () => {
  const home = 'C:\\Users\\lenzi';
  const native = 'C:\\Users\\lenzi\\.local\\bin\\claude.exe';
  const windowsPath = 'C:\\Windows\\System32';

  it('keeps the bare name when claude.exe is on PATH', () => {
    const onPath = (p: string) => p === 'C:\\Tools\\claude.exe';
    expect(resolveCommand(['claude'], { PATH: `C:\\Tools;${windowsPath}` }, 'win32', onPath, home)).toEqual(['claude']);
  });

  it('uses the native install when PATH does not have it (the installer does not always add the folder)', () => {
    expect(resolveCommand(['claude'], { PATH: windowsPath }, 'win32', (p) => p === native, home)).toEqual([native]);
  });

  it('keeps the bare name when there is no claude.exe at all, so the message says how to install it', () => {
    expect(resolveCommand(['claude'], { PATH: windowsPath }, 'win32', () => false, home)).toEqual(['claude']);
  });

  it('leaves other commands, and other systems, alone', () => {
    expect(resolveCommand(['node', 'x.mjs'], { PATH: windowsPath }, 'win32', () => true, home)).toEqual(['node', 'x.mjs']);
    expect(resolveCommand(['claude'], { PATH: '/usr/bin' }, 'linux', () => true, home)).toEqual(['claude']);
  });
});
