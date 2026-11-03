import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Secrets the app must keep to work for a user (a CRM access key, later AI provider keys):
 * encrypted with AES-256-GCM under ENCRYPTION_KEY, which lives only in .env.
 *
 * Sealed form: `v1.<iv>.<tag>.<ciphertext>`, base64url. Each secret is bound to a context (e.g.
 * `crm_link:42`, the table and the user): a sealed value copied to another user's row does not open.
 * A database dump without .env reveals no key.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('The encryption key must be 32 bytes');
    this.key = key;
  }

  seal(plain: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  /** The secret, or null when it does not open (another key, another context, a damaged value). */
  open(sealed: string, context: string): string | null {
    const [version, iv, tag, data, ...rest] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined || rest.length > 0) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}

/** Development only: a production instance refuses to start without its own ENCRYPTION_KEY. */
export const DEV_ENCRYPTION_KEY = createHash('sha256').update('vtiger-reader-development-encryption-key').digest();

/** ENCRYPTION_KEY as given in .env: 32 bytes, base64 (openssl rand -base64 32). */
export function parseEncryptionKey(raw: string): Buffer {
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes in base64: openssl rand -base64 32');
  return key;
}
