import { writeFile } from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { FirstAdminConfig } from '../../config.js';
import type { Pool } from '../../db/pool.js';
import { generatePassword } from '../identity/passwords.js';
import * as repo from './repository.js';
import type { AccountLifecycle } from './service.js';

/**
 * The instance's first administrator (design-accounts.md, "first account"; lenzi, 2026-10-03:
 * "non possiamo semplicemente creare l'utente con la mail che chiediamo nel compose? per ora usa una
 * mail fittizia e la password la scrivi in un txt alla root del progetto chiamato:
 * to_delete.password.txt").
 *
 * At startup, after the migrations, while no administrator exists: ADMIN_USERNAME / ADMIN_EMAIL from
 * the Compose settings become an administrator with a generated password, written to
 * to_delete.password.txt at the project root (readable by its owner only) and never to the log.
 * When the file cannot be written, the administrator stays and the log says how to give it a
 * password from the command line.
 */
export type FirstAdminResult = 'exists' | 'not-configured' | 'created' | 'created-without-file' | 'failed';

export async function ensureFirstAdmin(
  deps: { pool: Pool; accounts: AccountLifecycle; log: FastifyBaseLogger },
  config: FirstAdminConfig,
): Promise<FirstAdminResult> {
  if (await repo.hasAdministrator(deps.pool)) return 'exists';
  if (!config.username) {
    deps.log.warn('No administrator yet and ADMIN_USERNAME is not set: set it to create the first one');
    return 'not-configured';
  }
  const password = generatePassword();
  try {
    await deps.accounts.createUser({ username: config.username, email: config.email, password, role: 'admin' }, null);
  } catch (err) {
    // The reason in the message itself (a reserved word, the wrong letters, a taken email): it is
    // what whoever installs the instance reads, and fixes in .env.
    const reason = err instanceof Error ? err.message : String(err);
    deps.log.error(
      { err },
      `The first administrator "${config.username}" could not be created: ${reason}. ` +
        'Fix ADMIN_USERNAME or ADMIN_EMAIL in .env and start again.',
    );
    return 'failed';
  }
  const text = [
    'vtiger-reader: the first administrator',
    '',
    `username: ${config.username}`,
    `password: ${password}`,
    '',
    'Sign in with these, then delete this file. The password can be changed in Settings.',
    '',
  ].join('\n');
  try {
    await writeFile(config.passwordFile, text, { mode: 0o600 });
  } catch (err) {
    deps.log.error(
      { err },
      `The first administrator "${config.username}" was created, but its password could not be written to ${config.passwordFile}. ` +
        `Give it one with: docker compose exec app node dist/cli.js reset-password ${config.username}`,
    );
    return 'created-without-file';
  }
  deps.log.info(
    `The first administrator "${config.username}" was created: its password is in ${config.passwordFile} ` +
      '(to_delete.password.txt at the project root). Sign in, then delete the file.',
  );
  return 'created';
}
