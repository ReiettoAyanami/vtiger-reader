/** The interface's languages, as the API accepts them: English only for now (lenzi, 2026-11-03). */
export const LANGUAGES = [{ code: 'en', name: 'English' }] as const;

/** GET /api/settings: the user's preferences. */
export interface Settings {
  /** The interface's language. */
  language: (typeof LANGUAGES)[number]['code'];
  /** IANA time zone the CRM's times are shown in, e.g. "Europe/Rome". */
  timezone: string;
}
