/**
 * The one locale of the UI (lenzi, 2026-09-30): every text on screen is English, and numbers,
 * money and dates are formatted as in en-GB ("5 Sept 2026", "€6.50", "1,234.5", "65.4%"). Times
 * stay in the time zone of the settings. Every `Intl` format of the app, and the collator that puts
 * names in the API's order, use it.
 */
export const LOCALE = 'en-GB';
