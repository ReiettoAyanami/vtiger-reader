import { isDuplicateKeyError, type Pool } from '../../db/pool.js';
import { ProblemError, badRequest, conflict, notFound } from '../../shared/errors.js';
import { toIso } from '../../shared/time.js';
import { IMPERSONATION_MINUTES, USERNAME_PATTERN, type Auth } from './auth.js';
import { runAuth } from './insert-memory.js';
import { passwordProblem } from './passwords.js';
import * as repo from './repository.js';

/**
 * Identity (design-accounts.md, "Identity"): who is asking, and the users' credentials, roles and
 * blocks. The only holder of the Better Auth object; it knows nothing of the CRM, settings or
 * what a page shows, and nothing of who may do what to whom (the admin service decides that).
 */

export type Role = 'user' | 'admin';

/** Who is asking: the user of the request's session. */
export interface RequestUser {
  userId: number;
  username: string;
  role: Role;
  /** The administrator acting as this user (impersonation), or null. */
  impersonatedBy: number | null;
}

export interface NewUser {
  username: string;
  email: string;
  /** null: a user who cannot sign in until a password is set (test-user). */
  password: string | null;
  role: Role;
}

/** A user as the admin view shows it. */
export interface UserSummary {
  id: number;
  username: string;
  email: string;
  role: Role;
  /** Cannot sign in (design-accounts.md, "block (a user)"). */
  blocked: boolean;
  /** false: cannot sign in until an administrator sets a password (test-user). */
  hasPassword: boolean;
  createdAt: string;
}

/** What can change of a user besides the password (the username never does). */
export interface UserChanges {
  email?: string;
  role?: Role;
  blocked?: boolean;
}

/**
 * Top-level paths of the app and the server: a user called `login` would hide the sign-in page.
 * `admin` is not one: the admin panel lives under the administrator's own username,
 * `/<username>/admin`, and "admin" is the compose files' default first administrator (lenzi,
 * 2026-10-03).
 */
export const RESERVED_USERNAMES: readonly string[] = ['login', 'api', 'download', 'assets', 'media', 'setup'];

/** What is wrong with a username, or null. It is compared lowercase and never changes. */
export function usernameProblem(username: string): string | null {
  if (username.length < 3) return 'The username needs at least 3 characters';
  if (username.length > 30) return 'The username can have at most 30 characters';
  if (!USERNAME_PATTERN.test(username)) return 'The username can only have lowercase letters, digits, - and _';
  if (RESERVED_USERNAMES.includes(username)) return `"${username}" is a reserved word`;
  return null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is wrong with an email, or null: no email is ever sent, so the shape is all that counts. */
export function emailProblem(email: string): string | null {
  if (email.length > 254) return 'The email can have at most 254 characters';
  if (!EMAIL_PATTERN.test(email)) return 'The email is not valid';
  return null;
}

interface AuthErrorBody {
  code?: string;
  message?: string;
}

const EMAIL_TAKEN = 'This email is already used by another user';

/** Better Auth's errors as the API's problems. */
function asProblem(err: unknown): unknown {
  const body = (err as { body?: AuthErrorBody } | null)?.body;
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  if (!body?.code || typeof status !== 'number') return err;
  switch (body.code) {
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
    case 'USER_ALREADY_EXISTS':
      return conflict('email-taken', EMAIL_TAKEN, 'email');
    case 'USERNAME_IS_ALREADY_TAKEN':
      return conflict('username-taken', 'This username is already taken', 'username');
    case 'INVALID_EMAIL':
      return badRequest('The email is not valid', 'email');
    default:
      return new ProblemError(status, body.code.toLowerCase().replace(/_/g, '-'), body.message ?? body.code);
  }
}

function toSummary(row: repo.UserRow): UserSummary {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'user',
    blocked: row.banned,
    hasPassword: row.has_password,
    createdAt: toIso(row.created_at),
  };
}

export class Identity {
  constructor(
    private readonly auth: Auth,
    private readonly pool: Pool,
  ) {}

  /** The auth endpoints the app uses (routes.ts decides which), answered by Better Auth. */
  handle(request: Request): Promise<Response> {
    return runAuth(() => this.auth.handler(request));
  }

  /**
   * Who is asking, from the request's session cookie, or null. An impersonation older than an hour
   * ends here: Better Auth would stretch it to the 30 days of any session at its first read.
   */
  async userOf(headers: Headers): Promise<RequestUser | null> {
    const found = await runAuth(() => this.auth.api.getSession({ headers }));
    if (!found) return null;
    const { user, session } = found;
    const impersonatedBy = session.impersonatedBy ? Number(session.impersonatedBy) : null;
    if (impersonatedBy !== null && Date.now() - new Date(session.createdAt).getTime() > IMPERSONATION_MINUTES * 60_000) {
      const context = await this.auth.$context;
      await runAuth(() => context.internalAdapter.deleteSession(session.token));
      return null;
    }
    return {
      userId: Number(user.id),
      username: String(user.username),
      role: user.role === 'admin' ? 'admin' : 'user',
      impersonatedBy,
    };
  }

  /** Every user, by username. */
  async listUsers(): Promise<UserSummary[]> {
    return (await repo.listUsers(this.pool)).map(toSummary);
  }

  async findUser(id: number): Promise<UserSummary | null> {
    const row = await repo.findUser(this.pool, id);
    return row ? toSummary(row) : null;
  }

  /** The id of the user with this username (any case), or null. */
  async userIdOf(username: string): Promise<number | null> {
    return repo.findUserIdByUsername(this.pool, username.trim().toLowerCase());
  }

  /** How many administrators can sign in, `userId` left out of the count. */
  async activeAdministratorsBesides(userId: number): Promise<number> {
    return repo.countActiveAdministratorsBesides(this.pool, userId);
  }

  /** Creates a user with its credentials only (Account lifecycle adds its starting state). */
  async createUser(input: NewUser): Promise<number> {
    const username = input.username.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    const nameProblem = usernameProblem(username);
    if (nameProblem) throw badRequest(nameProblem, 'username');
    const mailProblem = emailProblem(email);
    if (mailProblem) throw badRequest(mailProblem, 'email');
    if (input.password !== null) {
      const problem = passwordProblem(input.password);
      if (problem) throw badRequest(problem, 'password');
    }
    try {
      const created = await runAuth(() =>
        this.auth.api.createUser({
          body: {
            email,
            name: '',
            role: input.role,
            data: { username },
            ...(input.password === null ? {} : { password: input.password }),
          },
        }),
      );
      return Number(created.user.id);
    } catch (err) {
      throw asProblem(err);
    }
  }

  /**
   * The email as it would be stored (trimmed, lowercase), when it can be this user's: well formed
   * and nobody else's. `userId` null: for a user still to be created.
   */
  async checkEmail(userId: number | null, email: string): Promise<string> {
    const normalized = email.trim().toLowerCase();
    const problem = emailProblem(normalized);
    if (problem) throw badRequest(problem, 'email');
    const holder = await repo.userIdByEmail(this.pool, normalized);
    if (holder !== null && holder !== userId) throw conflict('email-taken', EMAIL_TAKEN, 'email');
    return normalized;
  }

  /**
   * Throws when a password cannot be the user's next one: the rules, or a password the user already
   * had (the current one or any earlier one, design-accounts.md "password rules"). `field`: the form
   * field the problems go under.
   */
  async checkNewPassword(userId: number, password: string, field = 'password'): Promise<void> {
    const problem = passwordProblem(password);
    if (problem) throw badRequest(problem, field);
    const context = await this.auth.$context;
    await runAuth(async () => {
      const user = await context.internalAdapter.findUserById(String(userId));
      if (!user) throw notFound('User', userId);
      const account = await context.internalAdapter.findCredentialAccount(String(userId));
      const earlier = await repo.passwordHistory(this.pool, userId);
      for (const hash of [account?.password, ...earlier]) {
        if (hash && (await context.password.verify({ hash, password }))) {
          throw conflict('password-used-before', 'This password was already used: choose one never used before', field);
        }
      }
    });
  }

  /**
   * A new password for a user (an administrator's reset, the command line, the first account): the
   * rules, never one the user already had, and every session of the user closed. A user without a
   * password (test-user) gets its credential account here.
   */
  async setPassword(userId: number, password: string): Promise<void> {
    await this.checkNewPassword(userId, password);
    await this.storePassword(userId, password, null);
  }

  /**
   * A user changing their own password from the settings (design-accounts.md, "password reset"):
   * the current one must be given, the new one follows the rules and was never theirs. The session
   * in use stays open; the user's other sessions close, since a new password is often a lost or a
   * shared one.
   */
  async changeOwnPassword(headers: Headers, currentPassword: string, newPassword: string): Promise<void> {
    const found = await runAuth(() => this.auth.api.getSession({ headers }));
    if (!found) throw new ProblemError(401, 'unauthenticated', 'Sign in to use the app');
    const userId = Number(found.user.id);
    const context = await this.auth.$context;
    const account = await runAuth(() => context.internalAdapter.findCredentialAccount(String(userId)));
    const right = account?.password ? await context.password.verify({ hash: account.password, password: currentPassword }) : false;
    if (!right) {
      const detail = 'This is not your current password';
      throw new ProblemError(400, 'wrong-password', detail, [{ field: 'currentPassword', message: detail }]);
    }
    await this.checkNewPassword(userId, newPassword, 'newPassword');
    await this.storePassword(userId, newPassword, found.session.token);
  }

  /**
   * Stores a password already checked: the hash, the one it replaces into the history, and the
   * user's sessions closed, except `keepToken` (the session of a user changing their own).
   */
  private async storePassword(userId: number, password: string, keepToken: string | null): Promise<void> {
    const context = await this.auth.$context;
    await runAuth(async () => {
      const account = await context.internalAdapter.findCredentialAccount(String(userId));
      const hash = await context.password.hash(password);
      if (account) {
        await context.internalAdapter.updatePassword(String(userId), hash);
        if (account.password) await repo.addPasswordToHistory(this.pool, userId, account.password);
      } else {
        await context.internalAdapter.createAccount({
          userId: String(userId),
          providerId: 'credential',
          accountId: String(userId),
          password: hash,
        });
      }
      if (keepToken === null) {
        await context.internalAdapter.deleteUserSessions(String(userId));
      } else {
        const others = (await context.internalAdapter.listSessions(String(userId))).filter((s) => s.token !== keepToken);
        if (others.length > 0) await context.internalAdapter.deleteSessions(others.map((s) => s.token));
      }
    });
  }

  /**
   * Changes a user's email, role or block. A blocked user is out at once (its sessions closed); an
   * administrator who is blocked or becomes a user also loses the impersonations it has open.
   */
  async updateUser(id: number, changes: UserChanges): Promise<void> {
    const fields: repo.UserChanges = {};
    if (changes.email !== undefined) fields.email = await this.checkEmail(id, changes.email);
    if (changes.role !== undefined) fields.role = changes.role;
    if (changes.blocked !== undefined) fields.banned = changes.blocked;
    let found: boolean;
    try {
      found = await repo.updateUser(this.pool, id, fields, new Date());
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('email-taken', EMAIL_TAKEN, 'email');
      throw err;
    }
    if (!found) throw notFound('User', id);
    if (changes.blocked === true) {
      const context = await this.auth.$context;
      await runAuth(() => context.internalAdapter.deleteUserSessions(String(id)));
    }
    if (changes.blocked === true || changes.role === 'user') await this.endImpersonationsBy(id);
  }

  /** Closes the sessions an administrator opened as other users. */
  async endImpersonationsBy(adminId: number): Promise<void> {
    const tokens = await repo.impersonationTokensBy(this.pool, adminId);
    if (tokens.length === 0) return;
    const context = await this.auth.$context;
    await runAuth(() => context.internalAdapter.deleteSessions(tokens));
  }

  /**
   * Starts an impersonation for the administrator signed in with `headers`: Better Auth opens a
   * session as the user (with `impersonated_by`) and keeps the administrator's own session in a
   * signed cookie for the way back (`/api/auth/admin/stop-impersonating`). Returns the cookies to
   * send to the browser.
   */
  async impersonate(headers: Headers, userId: number): Promise<string[]> {
    try {
      const result = await runAuth(() =>
        this.auth.api.impersonateUser({ body: { userId: String(userId) }, headers, returnHeaders: true }),
      );
      return result.headers.getSetCookie();
    } catch (err) {
      const code = (err as { body?: AuthErrorBody } | null)?.body?.code;
      if (code === 'BANNED_USER') throw conflict('user-blocked', 'A blocked user cannot be impersonated: unblock it first');
      if (code === 'USER_NOT_FOUND') throw notFound('User', userId);
      throw asProblem(err);
    }
  }
}
