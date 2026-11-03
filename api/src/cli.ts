import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createAuth } from './modules/identity/auth.js';
import { Identity } from './modules/identity/identity.js';
import { authDatabase } from './modules/identity/insert-memory.js';
import { generatePassword } from './modules/identity/passwords.js';

/**
 * The command line of the app image (design-accounts.md, "password reset"):
 *
 *   docker compose exec app node dist/cli.js reset-password <username>
 *
 * gives anyone, administrators included, a new random password, prints it once and closes their
 * sessions. Whoever can run it already controls the server, so it opens nothing new.
 */

export interface CliOutput {
  out: (line: string) => void;
  err: (line: string) => void;
}

export const USAGE = 'Usage: node dist/cli.js reset-password <username>';

/** Runs one command and returns its exit code: 0 done, 1 no such user, 2 not a command. */
export async function runCli(args: readonly string[], identity: Identity, output: CliOutput): Promise<number> {
  const [command, username, ...rest] = args;
  if (command !== 'reset-password' || !username || rest.length > 0) {
    output.err(USAGE);
    return 2;
  }
  const id = await identity.userIdOf(username);
  if (id === null) {
    output.err(`There is no user called "${username}".`);
    return 1;
  }
  const password = generatePassword();
  await identity.setPassword(id, password);
  output.out(`New password for ${username.trim().toLowerCase()}: ${password}`);
  output.out('It is shown only this once. Their sessions are closed: they sign in again with it.');
  return 0;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.db, { connectionLimit: 2 });
  try {
    const auth = createAuth(authDatabase(pool), {
      appUrl: config.auth.appUrl,
      secret: config.auth.secret,
      cookiePrefix: config.auth.cookiePrefix,
      rateLimit: false,
    });
    process.exitCode = await runCli(process.argv.slice(2), new Identity(auth, pool), {
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
