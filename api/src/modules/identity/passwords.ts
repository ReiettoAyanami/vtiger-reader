import { randomInt } from 'node:crypto';

/**
 * The password rules (lenzi, 2026-10-03): at least 12 characters, at least one digit, at least one
 * special character (anything that is neither a letter nor a digit), and never a password the user
 * already had (checked by Identity against the history). 128 is Better Auth's own upper bound.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** What breaks the rules, in words for the person typing it, or null when it follows them. */
export function passwordProblem(password: string): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return `The password needs at least ${PASSWORD_MIN_LENGTH} characters`;
  if (length > PASSWORD_MAX_LENGTH) return `The password can have at most ${PASSWORD_MAX_LENGTH} characters`;
  if (!/\p{Nd}/u.test(password)) return 'The password needs at least one digit';
  if (!/[^\p{L}\p{N}]/u.test(password)) return 'The password needs at least one special character (not a letter or a digit)';
  return null;
}

const LETTERS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'; // no l, o, I, O: read aloud or copied by hand
const DIGITS = '23456789'; // no 0, 1
const SPECIALS = '-_.!@#%+=';
const ALL = LETTERS + DIGITS + SPECIALS;

/** A random password that follows the rules: 20 characters, at least one digit and one special. */
export function generatePassword(length = 20): string {
  const pick = (alphabet: string) => alphabet[randomInt(alphabet.length)] as string;
  const chars = Array.from({ length }, () => pick(ALL));
  // A digit and a special character at two different random places.
  const digitAt = randomInt(length);
  let specialAt = randomInt(length - 1);
  if (specialAt >= digitAt) specialAt++;
  chars[digitAt] = pick(DIGITS);
  chars[specialAt] = pick(SPECIALS);
  return chars.join('');
}
