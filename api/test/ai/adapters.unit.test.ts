import { describe, expect, it } from 'vitest';
import { AiError } from '../../src/modules/ai/adapter.js';
import { AnthropicAdapter } from '../../src/modules/ai/anthropic.js';
import { OpenAiAdapter } from '../../src/modules/ai/openai.js';
import { FakeAnthropic, FakeOpenAi } from '../support/fake-ai.js';

const ask = { system: 'rules and ticket', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Summarize' }] }] };

async function failure(promise: Promise<unknown>): Promise<AiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiError);
  return error as AiError;
}

describe('OpenAI-style adapter', () => {
  it('lists the models, sorted', async () => {
    const fake = new FakeOpenAi();
    const models = await new OpenAiAdapter(fake.base, fake.key, { fetch: fake.fetch }).models();
    expect(models).toEqual([
      { id: 'model-a', name: 'model-a', vision: null },
      { id: 'model-b', name: 'model-b', vision: null },
    ]);
  });

  it('streams the answer, then the tokens used; the system prompt first, the key as a bearer', async () => {
    const fake = new FakeOpenAi();
    const texts: string[] = [];
    const result = await new OpenAiAdapter(fake.base, fake.key, { fetch: fake.fetch }).stream({ ...ask, model: 'model-a' }, (t) => texts.push(t));
    expect(texts.join('')).toBe('Il cliente non riesce a stampare.');
    expect(result).toEqual({ model: 'model-a', inputTokens: 321, outputTokens: 12 });
    const sent = fake.sent.at(-1)!;
    expect(sent.body).toMatchObject({ model: 'model-a', stream: true, messages: [{ role: 'system', content: 'rules and ticket' }, { role: 'user', content: 'Summarize' }] });
  });

  it('images as data addresses, next to the text', async () => {
    const fake = new FakeOpenAi();
    await new OpenAiAdapter(fake.base, fake.key, { fetch: fake.fetch }).stream(
      { model: 'model-a', system: 's', messages: [{ role: 'user', content: [{ type: 'image', mediaType: 'image/jpeg', data: 'AAAA' }, { type: 'text', text: 'Look' }] }] },
      () => undefined,
    );
    expect(fake.sent.at(-1)!.body.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      { type: 'text', text: 'Look' },
    ]);
  });

  it('a wrong key, a refusal, a provider that does not answer: each its kind', async () => {
    const fake = new FakeOpenAi();
    expect((await failure(new OpenAiAdapter(fake.base, 'wrong', { fetch: fake.fetch }).models())).kind).toBe('auth');
    fake.refuse = true;
    expect((await failure(new OpenAiAdapter(fake.base, fake.key, { fetch: fake.fetch }).stream({ ...ask, model: 'm' }, () => undefined))).kind).toBe('refused');
    fake.down = true;
    expect((await failure(new OpenAiAdapter(fake.base, fake.key, { fetch: fake.fetch }).stream({ ...ask, model: 'm' }, () => undefined))).kind).toBe('unreachable');
  });
});

describe('Anthropic adapter (the official SDK)', () => {
  it('lists the models with whether they read images', async () => {
    const fake = new FakeAnthropic();
    expect(await new AnthropicAdapter(fake.key, { fetch: fake.fetch }).models()).toEqual([
      { id: 'claude-opus-5-5', name: 'Claude opus 5 5', vision: true },
      { id: 'claude-haiku-5-5', name: 'Claude haiku 5 5', vision: true },
    ]);
  });

  it('streams the answer; the system prompt cached; every input token counted', async () => {
    const fake = new FakeAnthropic();
    const texts: string[] = [];
    const result = await new AnthropicAdapter(fake.key, { fetch: fake.fetch }).stream({ ...ask, model: 'claude-opus-5-5' }, (t) => texts.push(t));
    expect(texts.join('')).toBe('Riassunto: la stampante è ferma.');
    expect(result).toEqual({ model: 'claude-opus-5-5', inputTokens: 120, outputTokens: 15 });
    const sent = fake.sent.find((r) => r.url.includes('/v1/messages'))!;
    expect(sent.body.system).toEqual([{ type: 'text', text: 'rules and ticket', cache_control: { type: 'ephemeral' } }]);
    expect(sent.body.max_tokens).toBe(16000);
    expect(sent.body.temperature).toBeUndefined();
    expect(sent.body.thinking).toBeUndefined();
  });

  it("Anthropic's own fallback on the models that take it, not on the others", async () => {
    const fake = new FakeAnthropic();
    const adapter = new AnthropicAdapter(fake.key, { fetch: fake.fetch });
    await adapter.stream({ ...ask, model: 'claude-opus-5-5' }, () => undefined);
    let sent = fake.sent.filter((r) => r.url.includes('/v1/messages')).at(-1)!;
    expect(sent.body.fallbacks).toBe('default');
    expect(sent.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    await adapter.stream({ ...ask, model: 'claude-haiku-5-5' }, () => undefined);
    sent = fake.sent.filter((r) => r.url.includes('/v1/messages')).at(-1)!;
    expect(sent.body.fallbacks).toBeUndefined();
  });

  it('images as base64 blocks', async () => {
    const fake = new FakeAnthropic();
    await new AnthropicAdapter(fake.key, { fetch: fake.fetch }).stream(
      { model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', content: [{ type: 'image', mediaType: 'image/jpeg', data: 'AAAA' }, { type: 'text', text: 'Look' }] }] },
      () => undefined,
    );
    expect(fake.sent.find((r) => r.url.includes('/v1/messages'))!.body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
    });
  });

  it('a wrong key and a refusal: each its kind', async () => {
    const fake = new FakeAnthropic();
    expect((await failure(new AnthropicAdapter('wrong', { fetch: fake.fetch }).models())).kind).toBe('auth');
    fake.stopReason = 'refusal';
    expect((await failure(new AnthropicAdapter(fake.key, { fetch: fake.fetch }).stream({ ...ask, model: 'claude-opus-5-5' }, () => undefined))).kind).toBe('refused');
  });
});
