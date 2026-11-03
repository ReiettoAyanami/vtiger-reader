import type { Pool } from '../../db/pool.js';
import { ProblemError, badRequest, conflict } from '../../shared/errors.js';
import type { Owner } from '../../shared/owner.js';
import type { SecretBox } from '../../shared/secret-box.js';
import type { CrmClient, CrmCredentials } from './client.js';
import * as repo from './repository.js';
import { CrmError } from './webservice.js';

/** GET /api/crm/link: never the access key. */
export interface CrmLinkStatus {
  /** The company CRM's address (CRM_URL), null when the instance has none yet. */
  crmUrl: string | null;
  linked: boolean;
  username: string | null;
  linkedAt: string | null;
  lastLoginAt: string | null;
  /** Why the link cannot be used as it is (e.g. the saved key no longer opens), else null. */
  problem: string | null;
}

/** The sealed key's context: the table and the user, so a row copied to another user does not open. */
function keyContext(owner: Owner): string {
  return `crm_link:${owner.userId}`;
}

/**
 * Each user's own CRM account (plan 2.2). Linking checks the username and the access key with a
 * real login before saving anything; the key is stored sealed and never leaves the server again.
 */
export class CrmLinkService {
  constructor(
    private readonly pool: Pool,
    private readonly box: SecretBox,
    private readonly crmUrl: string | undefined,
    /** Null when the instance has no CRM_URL. */
    private readonly client: CrmClient | null,
  ) {}

  /** The user's credentials, for the client; null when not linked or the key does not open. */
  async credentialsOf(owner: Owner): Promise<CrmCredentials | null> {
    const link = await repo.findLink(this.pool, owner);
    if (!link) return null;
    const accessKey = this.box.open(link.accessKeySealed, keyContext(owner));
    return accessKey === null ? null : { username: link.crmUsername, accessKey };
  }

  async status(owner: Owner): Promise<CrmLinkStatus> {
    const link = await repo.findLink(this.pool, owner);
    const readable = link ? this.box.open(link.accessKeySealed, keyContext(owner)) !== null : false;
    return {
      crmUrl: this.crmUrl ?? null,
      linked: link !== null,
      username: link?.crmUsername ?? null,
      linkedAt: link?.linkedAt.toISOString() ?? null,
      lastLoginAt: link?.lastLoginAt?.toISOString() ?? null,
      problem:
        link && !readable
          ? "The saved access key can no longer be read (the server's encryption key changed): link the account again."
          : null,
    };
  }

  /** Links the user's CRM account, or replaces it, after a successful login with it. */
  async link(owner: Owner, input: { username: string; accessKey: string }): Promise<CrmLinkStatus> {
    if (!this.client) throw conflict('crm-not-configured', 'This instance has no CRM yet: CRM_URL is not set on the server');
    const credentials = { username: input.username.trim(), accessKey: input.accessKey.trim() };
    if (!credentials.username) throw badRequest('Required', 'username');
    if (!credentials.accessKey) throw badRequest('Required', 'accessKey');
    let crmUserId: string;
    try {
      crmUserId = (await this.client.login(credentials)).crmUserId;
    } catch (error) {
      if (error instanceof CrmError && error.kind === 'credentials') {
        throw badRequest('The CRM did not accept this username and access key', 'accessKey');
      }
      throw error;
    }
    await repo.saveLink(this.pool, owner, {
      crmUsername: credentials.username,
      accessKeySealed: this.box.seal(credentials.accessKey, keyContext(owner)),
      crmUserId,
    });
    // The session of the account linked before, if any, is not this one.
    await this.client.forget(owner);
    return this.status(owner);
  }

  async unlink(owner: Owner): Promise<void> {
    await this.client?.forget(owner);
    await repo.deleteLink(this.pool, owner);
  }

  /** The client's onLogin: the link's last login. */
  async loggedIn(owner: Owner, crmUserId: string): Promise<void> {
    await repo.touchLogin(this.pool, owner, crmUserId);
  }
}

/** A CrmError as the API answers it (the app's error handler uses it for every route). */
export function crmProblem(error: CrmError): ProblemError {
  switch (error.kind) {
    case 'not-linked':
      return new ProblemError(409, 'crm-not-linked', 'No CRM account is linked: link yours in Settings');
    case 'credentials':
      return new ProblemError(409, 'crm-credentials', 'The CRM refused your access key: link the account again in Settings');
    case 'unreachable':
      return new ProblemError(503, 'crm-unreachable', 'The CRM is not reachable right now');
    case 'denied':
      return new ProblemError(403, 'crm-denied', 'Your CRM account may not read this');
    case 'refused':
      return new ProblemError(500, 'crm-refused', 'The CRM link is read-only');
    default:
      return new ProblemError(502, 'crm-error', error.message);
  }
}
