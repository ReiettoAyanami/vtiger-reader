import type { Pool } from '../../db/pool.js';
import * as repo from './repository.js';

/**
 * The sign-in protection per username (design-accounts.md, "Sign-in protection"): after
 * `afterFailures` wrong passwords in a row, each further attempt waits `firstMs`, doubling at every
 * new failure up to `maxMs`; the first right password sets it back to nothing. A wait, never a
 * refusal: whoever has the right password always gets in, at worst a minute later, so nobody can
 * keep a user out by failing on purpose. The rate limit per address (Better Auth's, in the
 * database) limits how many attempts an address makes; this slows down guessing one password.
 */
export interface SignInDelay {
  afterFailures: number;
  firstMs: number;
  maxMs: number;
}

/** lenzi, 2026-10-03: after 5 wrong passwords in a row, 2 s, doubling up to 60 s. */
export const SIGN_IN_DELAY: SignInDelay = { afterFailures: 5, firstMs: 2_000, maxMs: 60_000 };

/** How long the next attempt waits after `failures` wrong passwords in a row. */
export function delayAfter(failures: number, delay: SignInDelay): number {
  if (failures < delay.afterFailures) return 0;
  return Math.min(delay.maxMs, delay.firstMs * 2 ** (failures - delay.afterFailures));
}

/** Usernames that belong to nobody, remembered at most this many at a time. */
const UNKNOWN_KEPT = 1_000;
/** ... and for this long after their last attempt. */
const UNKNOWN_KEPT_MS = 60 * 60_000;

export class SignInThrottle {
  /**
   * The same count for usernames nobody has, in memory: they protect nothing, but without them the
   * waits would tell which usernames exist. Lost at a restart, bounded in size.
   */
  private readonly unknown = new Map<string, repo.SignInFailures>();

  constructor(
    private readonly pool: Pool,
    private readonly delay: SignInDelay = SIGN_IN_DELAY,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** Waits what the failures of `username` ask for, counted from the last one, before an attempt is checked. */
  async beforeAttempt(username: string): Promise<void> {
    const record = await this.failuresOf(username);
    if (!record) return;
    const wait = record.lastFailureAt.getTime() + delayAfter(record.failures, this.delay) - this.now();
    if (wait > 0) await this.sleep(Math.min(wait, this.delay.maxMs));
  }

  /** The outcome of the attempt: a wrong password counts one more, a right one starts again from nothing. */
  async afterAttempt(username: string, right: boolean): Promise<void> {
    const userId = await repo.findUserIdByUsername(this.pool, username);
    if (userId !== null) {
      if (right) await repo.clearSignInFailures(this.pool, userId);
      else await repo.addSignInFailure(this.pool, userId, new Date(this.now()));
      return;
    }
    if (right) return;
    const earlier = this.knownUnknown(username);
    this.unknown.delete(username);
    this.unknown.set(username, { failures: (earlier?.failures ?? 0) + 1, lastFailureAt: new Date(this.now()) });
    if (this.unknown.size > UNKNOWN_KEPT) this.unknown.delete(this.unknown.keys().next().value as string);
  }

  private async failuresOf(username: string): Promise<repo.SignInFailures | null> {
    const userId = await repo.findUserIdByUsername(this.pool, username);
    return userId === null ? this.knownUnknown(username) : repo.signInFailures(this.pool, userId);
  }

  private knownUnknown(username: string): repo.SignInFailures | null {
    const record = this.unknown.get(username);
    if (record && this.now() - record.lastFailureAt.getTime() > UNKNOWN_KEPT_MS) {
      this.unknown.delete(username);
      return null;
    }
    return record ?? null;
  }
}
