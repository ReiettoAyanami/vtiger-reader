import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';

/** What key.json holds: the key sealed by the system for this Windows user, or plain where it cannot. */
type KeyFile = { v: 1; sealed: string } | { v: 1; plain: string };

const KEY_BYTES = 32;

/**
 * The key that seals the CRM access key and the AI keys in the database (plan 7.4). Made at the first
 * start and kept by the system for this Windows user (safeStorage: DPAPI), never in the database
 * next to what it opens. A key that can no longer be read (the profile copied to another PC or
 * user) is kept aside and a new one made: the app then asks for the CRM and AI keys again, nothing
 * else is lost. Call it after the app is ready.
 */
export function loadOrMakeKey(dataDir: string, log: (message: string) => void): Buffer {
  const file = join(dataDir, 'key.json');
  if (existsSync(file)) {
    const key = readKey(file);
    if (key) return key;
    const aside = `${file}.unreadable-${Date.now()}`;
    renameSync(file, aside);
    log(`the sealing key could not be read; kept aside as ${aside}, a new one made: link the CRM and the AI keys again`);
  }
  const key = randomBytes(KEY_BYTES);
  const content: KeyFile = safeStorage.isEncryptionAvailable()
    ? { v: 1, sealed: safeStorage.encryptString(key.toString('base64')).toString('base64') }
    : { v: 1, plain: key.toString('base64') };
  if ('plain' in content) log('the system cannot seal the key for this user: it is kept in the profile folder as it is');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(content), { mode: 0o600 });
  return key;
}

function readKey(file: string): Buffer | null {
  try {
    const content = JSON.parse(readFileSync(file, 'utf8')) as Partial<{ sealed: string; plain: string }>;
    const base64 =
      typeof content.sealed === 'string'
        ? safeStorage.decryptString(Buffer.from(content.sealed, 'base64'))
        : typeof content.plain === 'string'
          ? content.plain
          : '';
    const key = Buffer.from(base64, 'base64');
    return key.length === KEY_BYTES ? key : null;
  } catch {
    return null;
  }
}
