import { createHash } from 'node:crypto';
import type { Owner } from '../../shared/owner.js';
import { isPublicHost } from '../../shared/public-host.js';
import { countText, isRecordId, selectText, type VtqlSelect } from './vtql.js';
import { CrmError, Webservice, crmBaseUrl, type Fetch, type Params, type ReadOperation } from './webservice.js';

/** A user's CRM account: what they typed when linking it (the key decrypted, in memory only). */
export interface CrmCredentials {
  /** The CRM's address, as crmBaseUrl gives it (each user links their own: lenzi, 2026-11-03). */
  url: string;
  username: string;
  accessKey: string;
}

/** A webservice session: its token and the CRM user it belongs to (e.g. `19x5`). */
export interface CrmLogin {
  sessionName: string;
  crmUserId: string;
}

/** A field of a module, as `describe` gives it: name, label, type and, for picklists, the values. */
export interface CrmField {
  name: string;
  label: string;
  type: string;
  /** The modules a reference field points to (e.g. a ticket's parent_id: Accounts, Contacts). */
  refersTo: string[];
  /** For picklists: the values, as stored and as shown. */
  picklist: Array<{ value: string; label: string }>;
}

export interface CrmModule {
  name: string;
  label: string;
  fields: CrmField[];
}

export interface ClientOptions {
  /** The HTTP client (tests pass a fake CRM). */
  fetch?: Fetch;
  /** May the server call this host? Public addresses only, unless tests say otherwise. */
  hostAllowed?: (host: string) => Promise<boolean>;
  /** Where a user's credentials come from (the crm_link row, decrypted); null: not linked. */
  credentialsOf: (owner: Owner) => Promise<CrmCredentials | null>;
  /** Called after each successful login (the link's "last login"). */
  onLogin?: (owner: Owner, login: CrmLogin) => Promise<void>;
  /** Milliseconds since the epoch (tests move it). */
  now?: () => number;
  /** How long a session is reused before a new login (10 minutes, as cerini-ia). */
  sessionTtlMs?: number;
  /** How long a module's schema is kept (1 hour: a field added to the CRM shows up). */
  schemaTtlMs?: number;
  /** Downloads of attachments at once, for the whole server (4). */
  maxFileDownloads?: number;
}

interface Session extends CrmLogin {
  url: string;
  startedAt: number;
}

/**
 * The CRM as one user sees it: every call goes out with that user's own session, so the CRM's own
 * permissions decide what they can read.
 *
 * What this keeps in memory (plan 2.4), and nothing else: each user's session token, and each
 * module's schema per CRM and CRM user (field names, labels, picklist values: no records). Records,
 * names and attachments are fetched on every request and never kept.
 *
 * Each user's CRM is at the address they linked; before every login the address must still resolve
 * to public addresses only (a name can be pointed elsewhere after it was checked).
 */
export class CrmClient {
  private readonly sessions = new Map<number, Session>();
  private readonly logins = new Map<number, Promise<Session>>();
  private readonly schemas = new Map<string, { module: CrmModule; at: number }>();
  private readonly files: Semaphore;
  private readonly now: () => number;
  private readonly sessionTtlMs: number;
  private readonly schemaTtlMs: number;

  private readonly hostAllowed: (host: string) => Promise<boolean>;

  constructor(private readonly options: ClientOptions) {
    this.hostAllowed = options.hostAllowed ?? isPublicHost;
    this.now = options.now ?? Date.now;
    this.sessionTtlMs = options.sessionTtlMs ?? 10 * 60_000;
    this.schemaTtlMs = options.schemaTtlMs ?? 60 * 60_000;
    this.files = new Semaphore(options.maxFileDownloads ?? 4);
  }

  /**
   * A login with these credentials, outside any user's session: what linking checks before saving.
   * challenge → login with md5(token + access key) (OpenCRM manual).
   */
  async login(credentials: CrmCredentials): Promise<CrmLogin> {
    const base = crmBaseUrl(credentials.url);
    if (!base || !(await this.hostAllowed(new URL(base).hostname))) {
      throw new CrmError('address', 'The CRM address must be a public https address');
    }
    const webservice = this.webservice(base);
    const challenge = await webservice.call('getchallenge', { username: credentials.username });
    const token = (challenge as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || !token) throw new CrmError('failed', 'CRM: no challenge token in the answer');
    const accessKey = createHash('md5').update(token + credentials.accessKey).digest('hex');
    const result = (await webservice.call('login', { username: credentials.username, accessKey })) as {
      sessionName?: unknown;
      userId?: unknown;
    } | null;
    if (typeof result?.sessionName !== 'string' || typeof result.userId !== 'string') {
      throw new CrmError('failed', 'CRM: no session in the login answer');
    }
    return { sessionName: result.sessionName, crmUserId: result.userId };
  }

  /** Drops the user's session (after unlinking, or a new key); logs it out of the CRM, best effort. */
  async forget(owner: Owner): Promise<void> {
    const session = this.sessions.get(owner.userId);
    this.sessions.delete(owner.userId);
    this.logins.delete(owner.userId);
    if (session) await this.webservice(session.url).call('logout', { sessionName: session.sessionName }).catch(() => undefined);
  }

  /** The CRM user id of the user's session (`19x5`): "assigned to me". */
  async crmUserId(owner: Owner): Promise<string> {
    return (await this.session(owner)).crmUserId;
  }

  /** One read operation in the user's session; a session the CRM has closed is opened again, once. */
  async read(owner: Owner, operation: ReadOperation, params: Params = {}, options: { timeoutMs?: number } = {}): Promise<unknown> {
    const first = await this.session(owner);
    try {
      return await this.webservice(first.url).call(operation, { ...params, sessionName: first.sessionName }, options);
    } catch (error) {
      if (!(error instanceof CrmError) || error.kind !== 'session') throw error;
      if (this.sessions.get(owner.userId) === first) this.sessions.delete(owner.userId);
      const second = await this.session(owner);
      return this.webservice(second.url).call(operation, { ...params, sessionName: second.sessionName }, options);
    }
  }

  /** A module's schema, as the user's CRM user sees it (fields hidden by their profile are absent). */
  async describe(owner: Owner, module: string): Promise<CrmModule> {
    const session = await this.session(owner);
    const key = `${session.url} ${session.crmUserId}:${module}`;
    const kept = this.schemas.get(key);
    if (kept && this.now() - kept.at < this.schemaTtlMs) return kept.module;
    const described = toModule(module, await this.read(owner, 'describe', { elementType: module }));
    this.schemas.set(key, { module: described, at: this.now() });
    return described;
  }

  /**
   * Rows of one module. Fields the user's CRM does not have are dropped first (the CRM refuses a
   * whole query for one unknown field; each CRM has its own custom fields).
   */
  async select(owner: Owner, select: VtqlSelect): Promise<Array<Record<string, unknown>>> {
    const known = new Set((await this.describe(owner, select.module)).fields.map((f) => f.name));
    const fields = select.fields.filter((f) => known.has(f));
    const result = await this.read(owner, 'query', { query: selectText({ ...select, fields }) });
    return Array.isArray(result) ? (result as Array<Record<string, unknown>>) : [];
  }

  /** How many rows of a module match a condition. */
  async count(owner: Owner, module: string, where?: string): Promise<number> {
    const result = await this.read(owner, 'query', { query: countText(module, where) });
    const row = Array.isArray(result) ? (result[0] as Record<string, unknown> | undefined) : undefined;
    const value = Number(row?.['count'] ?? row?.['count(*)'] ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  /** One record by id; null when the CRM does not have it, or the user may not see it. */
  async retrieve(owner: Owner, id: string): Promise<Record<string, unknown> | null> {
    if (!isRecordId(id)) return null;
    try {
      return (await this.read(owner, 'retrieve', { id })) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof CrmError && (error.kind === 'denied' || error.kind === 'failed')) return null;
      throw error;
    }
  }

  /** An attachment's bytes and name, at most `maxFileDownloads` at once over the whole server. */
  async file(owner: Owner, id: string): Promise<{ name: string; data: Buffer } | null> {
    if (!isRecordId(id)) return null;
    const result = await this.files.run(() => this.read(owner, 'files_retrieve', { id }, { timeoutMs: 60_000 }));
    const first = Array.isArray(result) ? (result[0] as Record<string, unknown> | undefined) : undefined;
    if (!first || typeof first['filecontents'] !== 'string') return null;
    return { name: String(first['filename'] ?? 'attachment'), data: Buffer.from(first['filecontents'], 'base64') };
  }

  private webservice(url: string): Webservice {
    return new Webservice({ url, ...(this.options.fetch ? { fetch: this.options.fetch } : {}) });
  }

  /** The user's session: the one in memory while fresh, else a new login (one at a time per user). */
  private async session(owner: Owner): Promise<Session> {
    const kept = this.sessions.get(owner.userId);
    if (kept && this.now() - kept.startedAt < this.sessionTtlMs) return kept;
    const pending = this.logins.get(owner.userId);
    if (pending) return pending;
    const login = this.startSession(owner).finally(() => {
      if (this.logins.get(owner.userId) === login) this.logins.delete(owner.userId);
    });
    this.logins.set(owner.userId, login);
    return login;
  }

  private async startSession(owner: Owner): Promise<Session> {
    const credentials = await this.options.credentialsOf(owner);
    if (!credentials) throw new CrmError('not-linked', 'No CRM account is linked: link one in Settings');
    const login = await this.login(credentials);
    const session: Session = { ...login, url: crmBaseUrl(credentials.url) ?? credentials.url, startedAt: this.now() };
    this.sessions.set(owner.userId, session);
    await this.options.onLogin?.(owner, login);
    return session;
  }
}

/** The parts of a `describe` answer the app uses. */
export function toModule(module: string, described: unknown): CrmModule {
  const d = (described ?? {}) as { name?: unknown; label?: unknown; fields?: unknown };
  const fields = Array.isArray(d.fields) ? d.fields : [];
  return {
    name: typeof d.name === 'string' ? d.name : module,
    label: typeof d.label === 'string' ? d.label : module,
    fields: fields.flatMap((raw): CrmField[] => {
      const f = raw as { name?: unknown; label?: unknown; type?: { name?: unknown; refersTo?: unknown; picklistValues?: unknown } };
      if (typeof f.name !== 'string') return [];
      const picklist = Array.isArray(f.type?.picklistValues) ? f.type.picklistValues : [];
      return [
        {
          name: f.name,
          label: typeof f.label === 'string' ? f.label : f.name,
          type: typeof f.type?.name === 'string' ? f.type.name : 'string',
          refersTo: Array.isArray(f.type?.refersTo) ? f.type.refersTo.filter((m): m is string => typeof m === 'string') : [],
          picklist: picklist.flatMap((p) => {
            const v = p as { value?: unknown; label?: unknown };
            return typeof v.value === 'string' ? [{ value: v.value, label: typeof v.label === 'string' ? v.label : v.value }] : [];
          }),
        },
      ];
    }),
  };
}

/** At most `size` tasks at once; the others wait their turn. */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
