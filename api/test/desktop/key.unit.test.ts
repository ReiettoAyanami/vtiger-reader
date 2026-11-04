import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The system's sealing, faked: reversible, and visibly not the plain key. */
const system = vi.hoisted(() => ({ available: true }));
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => system.available,
    encryptString: (text: string) => Buffer.from(`sealed:${Buffer.from(text).toString('hex')}`),
    decryptString: (sealed: Buffer) => {
      const text = sealed.toString();
      if (!text.startsWith('sealed:')) throw new Error('not sealed by this user');
      return Buffer.from(text.slice('sealed:'.length), 'hex').toString();
    },
  },
}));

const { loadOrMakeKey } = await import('../../src/desktop/key.js');

describe('the sealing key of the desktop app', () => {
  let dir: string;
  let said: string[];
  const log = (message: string) => said.push(message);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vtiger-reader-key-'));
    said = [];
    system.available = true;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('made at the first start, sealed by the system, the same at the next one', async () => {
    const key = loadOrMakeKey(dir, log);
    expect(key).toHaveLength(32);
    const stored = await readFile(join(dir, 'key.json'), 'utf8');
    expect(stored).not.toContain(key.toString('base64'));
    expect(JSON.parse(stored)).toEqual({ v: 1, sealed: expect.any(String) });
    expect(loadOrMakeKey(dir, log).equals(key)).toBe(true);
    expect(said).toEqual([]);
  });

  it('a key that can no longer be read is kept aside, and a new one made', async () => {
    await writeFile(join(dir, 'key.json'), JSON.stringify({ v: 1, sealed: Buffer.from('another user').toString('base64') }));
    const key = loadOrMakeKey(dir, log);
    expect(key).toHaveLength(32);
    expect((await readdir(dir)).some((name) => name.startsWith('key.json.unreadable-'))).toBe(true);
    expect(said[0]).toMatch(/could not be read/);
    expect(loadOrMakeKey(dir, log).equals(key)).toBe(true);
  });

  it('where the system cannot seal it, it is kept as it is, and said', async () => {
    system.available = false;
    const key = loadOrMakeKey(dir, log);
    expect(JSON.parse(await readFile(join(dir, 'key.json'), 'utf8'))).toEqual({ v: 1, plain: key.toString('base64') });
    expect(said[0]).toMatch(/cannot seal/);
    expect(loadOrMakeKey(dir, log).equals(key)).toBe(true);
  });
});
