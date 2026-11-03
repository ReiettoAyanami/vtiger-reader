import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AiError, type ChatRequest } from '../../src/modules/ai/adapter.js';
import { ClaudeCodeAdapter } from '../../src/modules/ai/claude-code.js';

const FAKE = ['node', fileURLToPath(new URL('../support/fake-claude.mjs', import.meta.url))];
const TOKEN = 'sk-ant-oat01-test-token-0000';

const request: ChatRequest = {
  model: 'sonnet',
  system: 'rules and <ticket>…</ticket>',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Summarize it' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'A printer is stuck.' }] },
    { role: 'user', content: [{ type: 'image', mediaType: 'image/jpeg', data: 'AAAA' }, { type: 'text', text: 'Look at the photos' }] },
  ],
};

async function ask(token: string, req: ChatRequest = request) {
  let text = '';
  const result = await new ClaudeCodeAdapter(token, { command: FAKE }).stream(req, (t) => (text += t));
  return { result, seen: JSON.parse(text) as { args: string[]; env: string[]; input: any } };
}

async function failure(promise: Promise<unknown>): Promise<AiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiError);
  return error as AiError;
}

describe('Claude Code adapter (the user’s own subscription)', () => {
  it('runs Claude Code headless, every tool off, nothing kept; streams the answer; counts every token', async () => {
    const { result, seen } = await ask(TOKEN);
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
    ]);
    expect(result).toEqual({ model: 'claude-sonnet-9', inputTokens: 110, outputTokens: 20 });
  });

  it('the token only in its environment, never on its command line; nothing of the server’s environment', async () => {
    process.env.DB_PASSWORD = 'server-secret';
    try {
      const { seen } = await ask(TOKEN);
      expect(seen.env).toEqual(['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_OAUTH_TOKEN', 'DISABLE_AUTOUPDATER', 'HOME', 'LANG', 'PATH']);
      expect(seen.args.join(' ')).not.toContain(TOKEN);
    } finally {
      delete process.env.DB_PASSWORD;
    }
  });

  it('one user message: the earlier turns as a transcript, then the photos and the request', async () => {
    const { seen } = await ask(TOKEN);
    expect(seen.input.type).toBe('user');
    expect(seen.input.message.content).toEqual([
      { type: 'text', text: 'Earlier in this conversation:\n\nTechnician: Summarize it\n\nYou: A printer is stuck.\n\nNow:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      { type: 'text', text: 'Look at the photos' },
    ]);
  });

  it('a refused token, the subscription’s limit, a crash, no program: each its kind', async () => {
    expect((await failure(ask('bad-token'))).kind).toBe('auth');
    expect((await failure(ask('limit-token'))).kind).toBe('rate-limit');
    expect((await failure(ask('crash-token'))).kind).toBe('unreachable');
    const missing = new ClaudeCodeAdapter(TOKEN, { command: ['/nonexistent/claude'] }).stream(request, () => undefined);
    expect((await failure(missing)).message).toBe('Claude Code is not installed on the server');
  });

  it('the Test: a tiny answer from Haiku, then the aliases', async () => {
    expect((await new ClaudeCodeAdapter(TOKEN, { command: FAKE }).models()).map((m) => m.id)).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
    await expect(new ClaudeCodeAdapter('bad-token', { command: FAKE }).models()).rejects.toMatchObject({ kind: 'auth' });
  });
});
