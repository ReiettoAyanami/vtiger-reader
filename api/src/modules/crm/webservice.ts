/**
 * The vtiger / OpenCRM Italia webservice: one HTTP call, `<the CRM's address>/webservice.php`, and its answer.
 *
 * Every answer is `{ success: true, result }` or `{ success: false, error: { code, message } }`
 * (OpenCRM manual, "Collegarsi al CRM tramite API"). This file knows nothing of users or sessions
 * (sessions.ts does): it sends one operation and turns whatever comes back into a result or a
 * CrmError.
 *
 * Read-only (lenzi, 2026-11-03): only the operations below exist here. create, update, revise,
 * delete and anything else are refused before a request leaves, so no route can write to the CRM
 * by mistake.
 */

/**
 * The operations the app may send. `retrieve_related` and `files_retrieve` are not in the OpenCRM
 * manual; cerini-ia uses them on the same CRM (comments, documents, attachments).
 */
export const READ_OPERATIONS = [
  'getchallenge',
  'login',
  'logout',
  'query',
  'retrieve',
  'describe',
  'listtypes',
  'retrieve_related',
  'files_retrieve',
] as const;
export type ReadOperation = (typeof READ_OPERATIONS)[number];

/** vtiger registers each operation as GET or POST, and refuses the other method; these are POST. */
const POST_OPERATIONS: ReadonlySet<string> = new Set(['login', 'logout']);

/**
 * What went wrong, in the terms the routes need:
 * - unreachable: no answer, a timeout, an HTTP error or an answer that is not the webservice's JSON;
 * - session: the session is unknown or expired (log in again and retry once);
 * - credentials: the CRM refused the username or the access key;
 * - denied: the CRM user may not do this (a module or a record outside their permissions);
 * - not-linked: the user has not linked a CRM account;
 * - address: the CRM's address is not a public https one (checked before every login);
 * - refused: an operation outside READ_OPERATIONS (a bug, never sent);
 * - failed: any other error the CRM reports (its message is kept).
 */
export type CrmErrorKind = 'unreachable' | 'session' | 'credentials' | 'denied' | 'not-linked' | 'address' | 'refused' | 'failed';

export class CrmError extends Error {
  constructor(
    readonly kind: CrmErrorKind,
    message: string,
    /** The CRM's own error code, when it gave one (INVALID_SESSIONID, ACCESS_DENIED...). */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CrmError';
  }
}

const SESSION_CODES = new Set(['INVALID_SESSIONID', 'AUTHENTICATION_REQUIRED', 'SESSION_EXPIRED']);
const CREDENTIAL_CODES = new Set(['INVALID_USER_CREDENTIALS', 'INVALID_AUTH_TOKEN', 'INVALID_USERNAME']);
const DENIED_CODES = new Set(['ACCESS_DENIED', 'PERMISSION_DENIED']);

/** The kind of an error the CRM reported, from its code, else (as cerini-ia does) from its words. */
export function kindOf(code: string, message: string): CrmErrorKind {
  if (SESSION_CODES.has(code)) return 'session';
  if (CREDENTIAL_CODES.has(code)) return 'credentials';
  if (DENIED_CODES.has(code)) return 'denied';
  if (/session/i.test(message)) return 'session';
  return 'failed';
}

export type Fetch = typeof fetch;

export interface WebserviceOptions {
  /** The CRM's address, with or without a trailing / or /webservice.php (crmBaseUrl). */
  url: string;
  /** The HTTP client (tests pass a fake CRM). */
  fetch?: Fetch;
  /** How long one call may take, in ms (20 s; files get 60 s, see sessions.ts). */
  timeoutMs?: number;
}

export type Params = Record<string, string>;

/**
 * A CRM's address as stored: https only, no user, query or fragment, without the trailing / or
 * /webservice.php (`https://x.opencrmitalia.com/webservice.php` → `https://x.opencrmitalia.com`).
 * Null when it is not one.
 */
export function crmBaseUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\/webservice\.php$/i, '').replace(/\/+$/, '');
  return `${parsed.origin}${path}`;
}

/** The webservice endpoint of a CRM address. */
export function endpointOf(url: string): string {
  const base = crmBaseUrl(url);
  if (!base) throw new Error(`Not a CRM address (https://...): "${url}"`);
  return `${base}/webservice.php`;
}

export class Webservice {
  readonly endpoint: string;
  private readonly fetch: Fetch;
  private readonly timeoutMs: number;

  constructor(options: WebserviceOptions) {
    this.endpoint = endpointOf(options.url);
    this.fetch = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  /** Sends one read operation; its `result`, or a CrmError. */
  async call(operation: ReadOperation, params: Params = {}, options: { timeoutMs?: number } = {}): Promise<unknown> {
    if (!(READ_OPERATIONS as readonly string[]).includes(operation)) {
      throw new CrmError('refused', `The CRM operation "${operation}" is not allowed: the link is read-only`);
    }
    const fields = new URLSearchParams({ operation, ...params });
    const post = POST_OPERATIONS.has(operation);
    const url = post ? this.endpoint : `${this.endpoint}?${fields}`;
    let text: string;
    let status: number;
    try {
      const response = await this.fetch(url, {
        method: post ? 'POST' : 'GET',
        headers: post ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
        ...(post ? { body: fields.toString() } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
        redirect: 'error',
      });
      status = response.status;
      text = await response.text();
    } catch {
      throw new CrmError('unreachable', 'The CRM does not answer');
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new CrmError('unreachable', `The CRM answered something that is not its API (HTTP ${status})`);
    }
    if (!isEnvelope(body)) throw new CrmError('unreachable', `The CRM answered something that is not its API (HTTP ${status})`);
    if (body.success) return body.result;
    const code = typeof body.error?.code === 'string' ? body.error.code : '';
    const message = typeof body.error?.message === 'string' && body.error.message ? body.error.message : 'error';
    throw new CrmError(kindOf(code, message), `CRM: ${message}`, code || undefined);
  }
}

interface Envelope {
  success: boolean;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

function isEnvelope(body: unknown): body is Envelope {
  return typeof body === 'object' && body !== null && typeof (body as { success?: unknown }).success === 'boolean';
}
