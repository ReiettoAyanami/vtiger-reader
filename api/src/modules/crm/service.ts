import type { Pool } from '../../db/pool.js';
import { ProblemError, badRequest } from '../../shared/errors.js';
import type { Owner } from '../../shared/owner.js';
import type { SecretBox } from '../../shared/secret-box.js';
import type { CrmClient, CrmCredentials } from './client.js';
import * as repo from './repository.js';
import { CrmError, crmBaseUrl } from './webservice.js';

/** GET /api/crm/link: never the access key. */
export interface CrmLinkStatus {
  /** The CRM the user linked (each user sets their own), null when not linked. */
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
    private readonly client: CrmClient,
  ) {}

  /** The user's credentials, for the client; null when not linked or the key does not open. */
  async credentialsOf(owner: Owner): Promise<CrmCredentials | null> {
    const link = await repo.findLink(this.pool, owner);
    if (!link) return null;
    const accessKey = this.box.open(link.accessKeySealed, keyContext(owner));
    return accessKey === null ? null : { url: link.crmUrl, username: link.crmUsername, accessKey };
  }

  async status(owner: Owner): Promise<CrmLinkStatus> {
    const link = await repo.findLink(this.pool, owner);
    const readable = link ? this.box.open(link.accessKeySealed, keyContext(owner)) !== null : false;
    return {
      crmUrl: link?.crmUrl ?? null,
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
  async link(owner: Owner, input: { url: string; username: string; accessKey: string }): Promise<CrmLinkStatus> {
    const url = crmBaseUrl(input.url);
    if (!url) throw badRequest('An https address, such as https://nomecrm.opencrmitalia.com', 'url');
    const credentials = { url, username: input.username.trim(), accessKey: input.accessKey.trim() };
    if (!credentials.username) throw badRequest('Required', 'username');
    if (!credentials.accessKey) throw badRequest('Required', 'accessKey');
    let crmUserId: string;
    try {
      crmUserId = (await this.client.login(credentials)).crmUserId;
    } catch (error) {
      if (!(error instanceof CrmError)) throw error;
      // Linking answers under the field to fix; the same errors later, on a ticket, are the CRM's.
      if (error.kind === 'credentials') throw badRequest('The CRM did not accept this username and access key', 'accessKey');
      if (error.kind === 'address') throw badRequest('Not a public https address: the server only calls CRMs on the internet', 'url');
      if (error.kind === 'unreachable') throw badRequest(`No CRM answers at this address: ${error.message}`, 'url');
      throw error;
    }
    await repo.saveLink(this.pool, owner, {
      crmUrl: url,
      crmUsername: credentials.username,
      accessKeySealed: this.box.seal(credentials.accessKey, keyContext(owner)),
      crmUserId,
    });
    // The session of the account linked before, if any, is not this one.
    await this.client.forget(owner);
    return this.status(owner);
  }

  async unlink(owner: Owner): Promise<void> {
    await this.client.forget(owner);
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
    case 'address':
      return new ProblemError(409, 'crm-address', 'The CRM address is no longer a public https address: link the account again in Settings');
    case 'refused':
      return new ProblemError(500, 'crm-refused', 'The CRM link is read-only');
    default:
      return new ProblemError(502, 'crm-error', error.message);
  }
}
