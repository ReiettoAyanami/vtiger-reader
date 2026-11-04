import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../../db/pool.js';
import { ownerOf, type Owner } from '../../shared/owner.js';
import { DEFAULT_SETTINGS } from '../settings/service.js';
import * as repo from './repository.js';

/**
 * The app's one profile (plan 7.1): the desktop app belongs to whoever uses the PC, so there are no
 * accounts and no sign-in. Every request works for this profile; the tables keep their user_id, so a
 * second profile (another CRM account) would need no new schema.
 */
export const LOCAL_USER_ID = 1;
export const LOCAL_OWNER: Owner = ownerOf(LOCAL_USER_ID);

declare module 'fastify' {
  interface FastifyRequest {
    /** Whose preferences the request works on: always the local profile. */
    owner: Owner;
  }
}

/** Every request works for the local profile. */
export function localProfileHook(app: FastifyInstance): void {
  app.decorateRequest('owner', {
    getter: () => LOCAL_OWNER,
  });
}

/**
 * Makes the local profile at the first start, with its starting state: its settings row and the
 * default lists of tickets. True when it made it; false when it was already there.
 */
export async function ensureLocalProfile(db: Queryable): Promise<boolean> {
  if (await repo.profileExists(db, LOCAL_OWNER)) return false;
  await repo.insertProfile(db, LOCAL_OWNER, { language: DEFAULT_SETTINGS.language, timezone: DEFAULT_SETTINGS.timezone });
  return true;
}
