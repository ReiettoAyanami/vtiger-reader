import type { Database } from '../../db/database.js';
import { badRequest } from '../../shared/errors.js';
import type { Owner } from '../../shared/owner.js';
import { isValidTimezone } from '../../shared/time.js';
import * as repo from './repository.js';

/**
 * The languages of the interface. English only for now (lenzi, 2026-11-03: "for now everything is
 * in english"); the setting exists from the start so that adding one is a translation, not a
 * migration.
 */
export const LANGUAGES = ['en'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Settings {
  language: Language;
  /** IANA zone the CRM's times are shown in. */
  timezone: string;
}

/** A user's settings until they change them (and the first administrator's). */
export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  timezone: 'Europe/Rome',
};

export interface SettingsPatch {
  language?: string;
  timezone?: string;
}

function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

/** Settings: one row per user; a user without one has the defaults. */
export class SettingsService {
  constructor(private readonly pool: Database) {}

  async get(owner: Owner): Promise<Settings> {
    const row = await repo.findSettings(this.pool, owner);
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      language: isLanguage(row.language) ? row.language : DEFAULT_SETTINGS.language,
      timezone: row.timezone,
    };
  }

  async update(owner: Owner, patch: SettingsPatch): Promise<Settings> {
    const next = await this.get(owner);
    if (patch.language !== undefined) {
      if (!isLanguage(patch.language)) throw badRequest(`language "${patch.language}" is not available`, 'language');
      next.language = patch.language;
    }
    if (patch.timezone !== undefined) {
      const zone = patch.timezone.trim();
      if (!isValidTimezone(zone)) throw badRequest(`timezone "${zone}" is not a valid IANA time zone`, 'timezone');
      next.timezone = zone;
    }
    await repo.saveSettings(this.pool, owner, next);
    return this.get(owner);
  }
}
