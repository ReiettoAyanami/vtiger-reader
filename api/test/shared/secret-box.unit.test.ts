import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { DEV_ENCRYPTION_KEY, SecretBox, parseEncryptionKey } from '../../src/shared/secret-box.js';

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32));

  it('opens what it sealed, with the same context; the sealed text does not contain the secret', () => {
    const sealed = box.seal('AbCdEf0123456789', 'crm_link:1');
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain('AbCdEf0123456789');
    expect(box.open(sealed, 'crm_link:1')).toBe('AbCdEf0123456789');
    // a new IV each time
    expect(box.seal('AbCdEf0123456789', 'crm_link:1')).not.toBe(sealed);
  });

  it('does not open with another context (another user’s row), another key, or a changed value', () => {
    const sealed = box.seal('secret', 'crm_link:1');
    expect(box.open(sealed, 'crm_link:2')).toBeNull();
    expect(new SecretBox(randomBytes(32)).open(sealed, 'crm_link:1')).toBeNull();
    const [v, iv, tag, data] = sealed.split('.') as [string, string, string, string];
    const flipped = data.slice(0, -1) + (data.endsWith('A') ? 'B' : 'A');
    expect(box.open([v, iv, tag, flipped].join('.'), 'crm_link:1')).toBeNull();
    expect(box.open('v2.a.b.c', 'crm_link:1')).toBeNull();
    expect(box.open('garbage', 'crm_link:1')).toBeNull();
  });

  it('needs a 32-byte key, given in base64', () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow();
    const raw = randomBytes(32).toString('base64');
    expect(parseEncryptionKey(raw)).toEqual(Buffer.from(raw, 'base64'));
    expect(() => parseEncryptionKey('change-me')).toThrow(/openssl rand -base64 32/);
  });
});

describe('CRM configuration', () => {
  const production = {
    NODE_ENV: 'production',
    APP_URL: 'https://tickets.example.com',
    AUTH_SECRET: 'x'.repeat(40),
  };

  it('production needs its own ENCRYPTION_KEY; development has a fixed one', () => {
    expect(() => loadConfig(production)).toThrow(/ENCRYPTION_KEY/);
    const key = randomBytes(32).toString('base64');
    expect(loadConfig({ ...production, ENCRYPTION_KEY: key }).crm.encryptionKey).toEqual(Buffer.from(key, 'base64'));
    expect(loadConfig({}).crm.encryptionKey).toEqual(DEV_ENCRYPTION_KEY);
  });

});
