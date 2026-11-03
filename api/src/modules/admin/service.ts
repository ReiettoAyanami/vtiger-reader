import { conflict, notFound } from '../../shared/errors.js';
import type { Owner } from '../../shared/owner.js';
import type { AccountLifecycle } from '../accounts/service.js';
import type { Identity, NewUser, RequestUser, Role, UserSummary } from '../identity/identity.js';
import { generatePassword } from '../identity/passwords.js';

/** What an administrator changes of another user: any of these, together or alone. */
export interface UserUpdate {
  email?: string;
  role?: Role;
  /** A reset: the rules, never a password the user already had; their sessions close. */
  password?: string;
  blocked?: boolean;
}

/** The administrator acting: the request's user, and its owner (whose settings a new user copies). */
export interface Actor {
  user: RequestUser;
  owner: Owner;
}

/**
 * What the admin view does (design-accounts.md, "Admin routes"): list, create, change, block,
 * delete and impersonate users, administrators included, with two rules over all of it: an
 * administrator never acts on itself, and there is always an administrator who can sign in.
 * Identity holds the credentials, Account lifecycle creates and deletes; this only decides.
 */
export class AdminService {
  constructor(
    private readonly identity: Identity,
    private readonly accounts: AccountLifecycle,
  ) {}

  list(): Promise<UserSummary[]> {
    return this.identity.listUsers();
  }

  async create(actor: Actor, input: NewUser): Promise<UserSummary> {
    const id = await this.accounts.createUser(input, actor.owner);
    return this.summaryOf(id);
  }

  /** Everything is checked before anything changes: a refused change leaves the user as it was. */
  async update(actor: Actor, id: number, changes: UserUpdate): Promise<UserSummary> {
    const target = await this.target(actor, id);
    if (changes.email !== undefined) await this.identity.checkEmail(id, changes.email);
    if (changes.password !== undefined) await this.identity.checkNewPassword(id, changes.password);
    if (changes.role === 'user' || changes.blocked === true) await this.keepAnAdministrator(target);

    if (changes.password !== undefined) await this.identity.setPassword(id, changes.password);
    const { email, role, blocked } = changes;
    if (email !== undefined || role !== undefined || blocked !== undefined) {
      await this.identity.updateUser(id, {
        ...(email === undefined ? {} : { email }),
        ...(role === undefined ? {} : { role }),
        ...(blocked === undefined ? {} : { blocked }),
      });
    }
    return this.summaryOf(id);
  }

  async remove(actor: Actor, id: number): Promise<void> {
    const target = await this.target(actor, id);
    await this.keepAnAdministrator(target);
    await this.accounts.deleteUser(id);
  }

  /** The cookies of the impersonation session, and whom it is of. */
  async impersonate(actor: Actor, id: number, headers: Headers): Promise<{ user: UserSummary; cookies: string[] }> {
    const user = await this.target(actor, id);
    return { user, cookies: await this.identity.impersonate(headers, id) };
  }

  /** A password that follows the rules, for the "Generate" button of the user form. */
  generatedPassword(): string {
    return generatePassword();
  }

  /** The user an administrator acts on: never itself, and one that exists. */
  private async target(actor: Actor, id: number): Promise<UserSummary> {
    if (id === actor.user.userId) {
      throw conflict('not-on-self', 'An administrator does not act on its own account: another administrator does');
    }
    const user = await this.identity.findUser(id);
    if (!user) throw notFound('User', id);
    return user;
  }

  /** Refuses to leave no administrator who can sign in. */
  private async keepAnAdministrator(target: UserSummary): Promise<void> {
    if (target.role !== 'admin' || target.blocked) return;
    if ((await this.identity.activeAdministratorsBesides(target.id)) === 0) {
      throw conflict('last-administrator', 'This is the last administrator who can sign in: make another one first');
    }
  }

  private async summaryOf(id: number): Promise<UserSummary> {
    const user = await this.identity.findUser(id);
    if (!user) throw notFound('User', id);
    return user;
  }
}
