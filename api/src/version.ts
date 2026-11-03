/**
 * The product's version, one string for the API and the web, which ship together (lenzi,
 * 2026-10-03; the build number 2026-10-05): `<prefix><year>.<backend>.<frontend>.<build>`, backend
 * and frontend from 0, the build always four digits (`0000`-`9999`).
 *
 * - `dev`: a development version, on dev or on the branch of work named after it without its build
 *   (`dev26.1.0.0000` on `dev26.1.0`); it may end with a short text for odd work
 *   (`dev26.0.1.0000-squircle`).
 * - `a` alpha, `b` beta, `v` release: final versions, only on main, numbers only.
 *
 * It changes only when lenzi says so: the backend number for an approved backend change, the
 * frontend number for an approved frontend change, the build for a small correction (made on dev,
 * with no branch of its own). A new backend or frontend number sets the build back to 0000
 * (dev26.0.0.0007 -> dev26.1.0.0000). The pages carry a copy of it and of API_LEVEL
 * (web/src/app/app-version.ts, for the Android app): the CI fails when the two differ.
 */
export const VERSION = 'dev26.0.0.0000';

/**
 * The API level the Android app compares with its own (design-android.md, "compatibility"): a whole
 * number that goes up only when a change makes an older app work wrong (a field removed or renamed,
 * a meaning changed, a route gone). Adding fields or routes, and a backend fix, leave it as it is.
 * Like VERSION, it changes only when lenzi says so.
 */
export const API_LEVEL = 1;

/** What a version may look like (VERSION is checked against it by the tests). */
export const VERSION_FORMAT = /^(?:dev\d{2}\.\d+\.\d+\.\d{4}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?|[abv]\d{2}\.\d+\.\d+\.\d{4})$/;
