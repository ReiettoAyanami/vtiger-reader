import { withTransaction, type Pool } from '../../db/pool.js';
import { notFound } from '../../shared/errors.js';
import { ownerOf, type Owner } from '../../shared/owner.js';
import type { Identity, NewUser } from '../identity/identity.js';
import { DEFAULT_SETTINGS, type SettingsService } from '../settings/service.js';
import * as repo from './repository.js';

/**
 * Account lifecycle: a user is created ready to use, credentials and settings together. A new user
 * starts with the settings of the administrator who creates them (colleagues of one company share a
 * time zone), the first administrator with the defaults. Deleting a user takes all of it away.
 */
export class AccountLifecycle {
  constructor(
    private readonly pool: Pool,
    private readonly identity: Identity,
    private readonly settings: SettingsService,
  ) {}

  /** The new user's id. `createdBy`: the administrator creating it, null for the first one. */
  async createUser(input: NewUser, createdBy: Owner | null): Promise<number> {
    const settings = createdBy ? await this.settings.get(createdBy) : DEFAULT_SETTINGS;
    const id = await this.identity.createUser(input);
    try {
      await withTransaction(this.pool, (conn) =>
        repo.insertStartingState(conn, ownerOf(id), { language: settings.language, timezone: settings.timezone }),
      );
    } catch (err) {
      await repo.deleteFreshUser(this.pool, id).catch(() => undefined);
      throw err;
    }
    return id;
  }

  /** Deletes a user and everything of theirs, in one transaction: their sessions end with it. */
  async deleteUser(id: number): Promise<void> {
    const deleted = await withTransaction(this.pool, (conn) => repo.deleteUser(conn, id));
    if (!deleted) throw notFound('User', id);
  }
}
