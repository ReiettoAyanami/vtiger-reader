import type { Pool } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import type { Owner } from '../../shared/owner.js';
import { Semaphore, type CrmClient } from '../crm/client.js';
import { containsLiteral, idLiteral, isRecordId, literal, MAX_ROWS } from '../crm/vtql.js';
import { CrmError } from '../crm/webservice.js';
import sharp from 'sharp';
import { looksLikeLogo, markFor, opensInline, printOf, sniffType, type Mark } from './files.js';
import type { ListFilter } from '../lists/filter.js';
import type { ListsService } from '../lists/service.js';
import { cleanMail, signerOf, type CleanText } from './mail.js';
import * as repo from './repository.js';
import { ticketSchema, type TicketSchema } from './schema.js';

/**
 * The tickets, read from the user's CRM at every request (plan 3): the user's lists, a page of one, a ticket, its
 * attachments. Nothing of the CRM is kept: the names behind the ids are read again each time, one
 * `retrieve` per distinct id, a few at once.
 */

/** Who a ticket is assigned to, or who wrote a comment, as the user may know them. */
export type Who =
  | { kind: 'me' }
  | { kind: 'group'; name: string }
  | { kind: 'customer'; id: string; name: string }
  /**
   * A user of the CRM other than the user: their names cannot be read with a user's key (plan 2.1).
   * On a comment, the name it is signed with, when there is one (read each time, never kept).
   */
  | { kind: 'colleague'; signedAs?: string }
  | { kind: 'nobody' };

export interface Ref {
  id: string;
  /** Null in a list: an organization's name costs a `retrieve` (~100 ms, plan 3), read later through /api/names. */
  name: string | null;
}

/** What a list's filter can name, from the user's CRM (the list editor's choices). */
export interface TicketOptions {
  statuses: Array<{ value: string; label: string; closed: boolean }>;
  groups: Array<{ id: string; name: string }>;
  /** The ticket's other picklists: category, support group, priority... */
  picklists: Array<{ field: string; label: string; values: Array<{ value: string; label: string }> }>;
}

export interface TicketRow {
  id: string;
  number: string;
  title: string;
  status: string;
  /** The status's place in the CRM's list of statuses (its colour on the page), -1 if not in it. */
  statusIndex: number;
  priority: string;
  category: string;
  createdAt: string | null;
  modifiedAt: string | null;
  owner: Who;
  organization: Ref | null;
  contact: Ref | null;
  closed: boolean;
}

export interface TicketPage {
  items: TicketRow[];
  page: number;
  size: number;
  total: number;
}

export interface ListQuery {
  /** One of the user's lists; their first when omitted. */
  list?: number;
  q?: string;
  status?: string;
  contact?: string;
  organization?: string;
  sort?: 'created' | 'modified';
  dir?: 'asc' | 'desc';
  page?: number;
  size?: number;
}

export interface Field {
  name: string;
  label: string;
  value: string;
}

export interface Comment {
  id: string;
  at: string | null;
  author: Who;
  private: boolean;
  body: CleanText;
  html: string;
  /** Attachment ids (files_retrieve) of the images of this comment. */
  files: string[];
  /** The mail that opened the ticket comes again as its first comment: shown once (plan 2.1). */
  sameAsDescription: boolean;
}

export interface TicketDetail extends TicketRow {
  crmLink: string;
  description: (CleanText & { html: string }) | null;
  solution: (CleanText & { html: string }) | null;
  fields: Field[];
  comments: Comment[];
  documents: Array<{ id: string; title: string; fileName: string; files: string[] }>;
}

/** A closed ticket that may be the same problem (plan 4.6). */
export interface SimilarTicket {
  id: string;
  number: string;
  title: string;
  solution: string;
  closedAt: string | null;
  /** How many of the searched words it has. */
  score: number;
}

/** Words that say nothing about a problem (Italian and English), left out of a search. */
const STOPWORDS = new Set(
  'alla allo alle agli dalla dalle dagli della delle degli nella nelle negli sulla sulle sugli come cosa questo questa quello quella sono siamo hanno ancora anche dopo prima perché quando dove senza tutto tutti tutte molto poco però oppure quindi grazie buongiorno salve gentile richiesta problema ticket cliente ufficio della with from that this have been there their they what when where which would could should about after before your please thanks hello issue problem request ticket'.split(
    ' ',
  ),
);

/** The words of a title worth searching: 4 letters or more, not a stopword, at most 5. */
export function searchWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)].slice(0, 5);
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  inline: boolean;
  width: number | null;
  height: number | null;
  /** The comment or document it belongs to. */
  from: { kind: 'comment' | 'document'; id: string };
  /** Shown with the signature images, collapsed: the user's mark, else the rule. */
  signature: boolean;
  mark: Mark | null;
}

/** The fields a list row and a ticket's header show; the rest of a ticket goes to its field list. */
const ROW_FIELDS = [
  'ticket_no',
  'ticket_title',
  'ticketstatus',
  'ticketpriorities',
  'ticketcategories',
  'createdtime',
  'modifiedtime',
  'assigned_user_id',
  'parent_id',
  'contact_id',
];

/** Not in a ticket's field list: in its header, its text, or no use to a reader. */
const NOT_LISTED = new Set([...ROW_FIELDS, 'id', 'label', 'tags', 'starred', 'source', 'modifiedby']);

/**
 * How many `retrieve`s (names behind ids) go out at once. The company CRM answers one session's
 * requests about one at a time, and more sessions help little (plan 3, measured 2026-11-03: 12
 * organizations take ~1.1 s, ~0.7 s over three sessions): a list does not wait for them.
 */
const NAME_LOOKUPS = new Semaphore(6);

/** At most this many ids per /api/names request. */
export const MAX_NAMES = 100;

/** The CRM's 'YYYY-MM-DD HH:MM:SS', which is UTC (plan 2.1), as an ISO instant. */
export function crmInstant(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)$/.exec(text);
  if (!match) return null;
  return `${match[1]}T${match[2]}${match[3] ? '' : ':00'}Z`;
}

/** An instant as the CRM writes its times: 'YYYY-MM-DD HH:MM:SS', UTC (plan 2.1). */
export function crmTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** A CRM time, or null when the value is not one ('YYYY-MM-DD HH:MM:SS'). */
export function crmTimeOf(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

/** A reference field's id, or '' for none (the CRM writes `0x0` or `` for an empty one). */
function refId(value: unknown): string {
  const id = str(value).trim();
  return isRecordId(id) && !/^0+x0+$/.test(id) && !id.endsWith('x0') ? id : '';
}

/** The name of a record as `retrieve` gives it: an organization, a contact, a group, or its label. */
function nameOf(record: Record<string, unknown>): string {
  const person = [str(record.firstname), str(record.lastname)].filter(Boolean).join(' ').trim();
  return (str(record.accountname) || person || str(record.groupname) || str(record.label)).trim();
}

/** A search typed like a ticket number (TT1234, TK-2026-000123, 000123) looks in the numbers. */
function looksLikeNumber(q: string): boolean {
  return /^[A-Za-z]{0,5}[-\s]?\d[\d-]*$/.test(q.trim());
}

export class TicketsService {
  constructor(
    private readonly pool: Pool,
    private readonly crm: CrmClient,
    private readonly lists: ListsService,
  ) {}

  private async schema(owner: Owner): Promise<TicketSchema> {
    return ticketSchema(await this.crm.describe(owner, 'HelpDesk'));
  }

  /** The CRM's groups (id → name): "unassigned" tickets are assigned to a group (plan 2.1). */
  private async groups(owner: Owner): Promise<Map<string, string>> {
    try {
      const rows = await this.crm.select(owner, { module: 'Groups', fields: ['groupname'], orderBy: { field: 'groupname', direction: 'ASC' } });
      return new Map(rows.map((r) => [str(r.id), str(r.groupname)]));
    } catch (error) {
      if (error instanceof CrmError && (error.kind === 'denied' || error.kind === 'failed')) return new Map();
      throw error;
    }
  }

  /** The names behind ids, one `retrieve` each, a few at once; an id the user may not read has none. */
  async names(owner: Owner, ids: Iterable<string>): Promise<Map<string, string>> {
    const unique = [...new Set([...ids].filter(Boolean))];
    const found = await Promise.all(
      unique.map((id) =>
        NAME_LOOKUPS.run(async () => {
          const record = await this.crm.retrieve(owner, id);
          return [id, record ? nameOf(record) : ''] as const;
        }),
      ),
    );
    return new Map(found.filter(([, name]) => name));
  }

  private who(id: string, me: string, groups: Map<string, string>): Who {
    if (!id) return { kind: 'nobody' };
    if (id === me) return { kind: 'me' };
    const group = groups.get(id);
    if (group !== undefined) return { kind: 'group', name: group };
    return { kind: 'colleague' };
  }

  /**
   * A list's conditions (joined with AND: the CRM's VTQL has no parentheses, plan 3). A value the
   * CRM no longer has (a status, a group, a category renamed) is a 409: the list must be edited.
   */
  private listConditions(filter: ListFilter, schema: TicketSchema, me: string, groups: Map<string, string>): string[] {
    const outdated = (what: string) => conflict('list-outdated', `This list asks for ${what}, which your CRM does not have: edit the list`);
    const conditions: string[] = [];
    switch (filter.owner) {
      case 'me':
        conditions.push(`assigned_user_id = ${idLiteral(me)}`);
        break;
      case 'groups':
        // Assigned to a group, not to a person: "unassigned" (the CRM has no prefix match on owners).
        conditions.push(`assigned_user_id IN (${(groups.size > 0 ? [...groups.keys()] : ['0x0']).map(idLiteral).join(', ')})`);
        break;
      case 'group':
        if (!filter.group || !groups.has(filter.group)) throw outdated('a group');
        conditions.push(`assigned_user_id = ${idLiteral(filter.group)}`);
        break;
    }
    const statuses = (values: string[]) => (values.length > 0 ? `ticketstatus IN (${values.map(literal).join(', ')})` : null);
    if (filter.status === 'open') {
      const open = statuses(schema.openStatuses);
      if (open) conditions.push(open);
    } else if (filter.status === 'closed') {
      const closed = statuses(schema.closedStatuses);
      if (closed) conditions.push(closed);
    } else if (filter.status === 'one') {
      if (!filter.statusValue || !schema.statusField?.picklist.some((p) => p.value === filter.statusValue)) throw outdated(`the status "${filter.statusValue}"`);
      conditions.push(`ticketstatus = ${literal(filter.statusValue)}`);
    }
    for (const [field, value] of Object.entries(filter.picks ?? {})) {
      const picklist = schema.picklists.find((f) => f.name === field);
      if (!picklist || !picklist.picklist.some((p) => p.value === value)) throw outdated(`"${value}"`);
      conditions.push(`${picklist.name} = ${literal(value)}`);
    }
    return conditions;
  }

  /** What a list's filter can name, from the user's CRM: its statuses, groups and picklists. */
  async options(owner: Owner): Promise<TicketOptions> {
    const [schema, groups] = await Promise.all([this.schema(owner), this.groups(owner)]);
    return {
      statuses: (schema.statusField?.picklist ?? []).map((s) => ({ ...s, closed: schema.closedStatuses.includes(s.value) })),
      groups: [...groups].map(([id, name]) => ({ id, name })),
      picklists: schema.picklists.map((f) => ({ field: f.name, label: f.label.trim(), values: f.picklist })),
    };
  }

  /** How many tickets each of the user's lists has (one CRM count each: apart from the lists, after the page). */
  async listCounts(owner: Owner, lists: ListsService): Promise<Record<string, number | null>> {
    const [all, schema, groups, me] = await Promise.all([lists.all(owner), this.schema(owner), this.groups(owner), this.crm.crmUserId(owner)]);
    const counting = new Semaphore(4);
    const counts = await Promise.all(
      all.map(async (list) => {
        let conditions: string[];
        try {
          conditions = this.listConditions(list.filter, schema, me, groups);
        } catch {
          return [String(list.id), null] as const;
        }
        const count = await counting
          .run(() => this.crm.count(owner, 'HelpDesk', conditions.join(' AND ') || undefined))
          .catch((error: unknown) => {
            if (error instanceof CrmError && (error.kind === 'failed' || error.kind === 'denied')) return null;
            throw error;
          });
        return [String(list.id), count] as const;
      }),
    );
    return Object.fromEntries(counts);
  }

  /** A page of one of the user's lists (plan 3.2): search, status, customer, sort, paging; the total with it. */
  async list(owner: Owner, query: ListQuery): Promise<TicketPage> {
    // The list first: one that is not the user's is not found, whatever the CRM would say.
    const list = await this.lists.getOrFirst(owner, query.list);
    const [schema, groups, me] = await Promise.all([this.schema(owner), this.groups(owner), this.crm.crmUserId(owner)]);
    const conditions = list ? this.listConditions(list.filter, schema, me, groups) : [];
    const q = (query.q ?? '').trim();
    if (q) conditions.push(`${looksLikeNumber(q) ? 'ticket_no' : 'ticket_title'} LIKE ${containsLiteral(q)}`);
    if (query.status) {
      if (!schema.statusField?.picklist.some((p) => p.value === query.status)) {
        throw badRequest(`No status "${query.status}"`, 'status');
      }
      conditions.push(`ticketstatus = ${literal(query.status)}`);
    }
    if (query.contact) conditions.push(`contact_id = ${idLiteral(query.contact)}`);
    if (query.organization) conditions.push(`parent_id = ${idLiteral(query.organization)}`);
    const where = conditions.join(' AND ') || undefined;
    const size = Math.min(Math.max(query.size ?? 50, 1), MAX_ROWS);
    const page = Math.max(query.page ?? 0, 0);
    const [rows, total] = await Promise.all([
      this.crm.select(owner, {
        module: 'HelpDesk',
        fields: ROW_FIELDS,
        ...(where ? { where } : {}),
        orderBy: { field: query.sort === 'modified' ? 'modifiedtime' : 'createdtime', direction: query.dir === 'asc' ? 'ASC' : 'DESC' },
        offset: page * size,
        limit: size,
      }),
      this.crm.count(owner, 'HelpDesk', where),
    ]);
    const names = await this.contactNames(owner, rows.map((r) => refId(r.contact_id)));
    return { items: rows.map((r) => this.row(r, schema, me, groups, names)), page, size, total };
  }

  /** The createdtime of the newest ticket the user's CRM shows them, or null when it shows none. */
  async newestCreated(owner: Owner): Promise<string | null> {
    const rows = await this.crm.select(owner, {
      module: 'HelpDesk',
      fields: ['createdtime'],
      orderBy: { field: 'createdtime', direction: 'DESC' },
      limit: 1,
    });
    return crmTimeOf(rows[0]?.createdtime);
  }

  /**
   * The tickets created after `after` (and not after `upTo`, when given) that are in any of these
   * lists (plan 5: what notifies, what the bell shows), newest first, at most `limit`. One CRM query
   * per list: the CRM's VTQL has no OR across them (no parentheses). A list that names a value the
   * CRM no longer has is skipped: the user sees it as outdated on the tickets page.
   */
  async createdAfter(owner: Owner, filters: readonly ListFilter[], after: string, options: { upTo?: string; limit?: number } = {}): Promise<TicketRow[]> {
    if (filters.length === 0) return [];
    const limit = Math.min(Math.max(options.limit ?? MAX_ROWS, 1), MAX_ROWS);
    const [schema, groups, me] = await Promise.all([this.schema(owner), this.groups(owner), this.crm.crmUserId(owner)]);
    const found = new Map<string, Record<string, unknown>>();
    for (const filter of filters) {
      let conditions: string[];
      try {
        conditions = this.listConditions(filter, schema, me, groups);
      } catch {
        continue;
      }
      const rows = await this.crm.select(owner, {
        module: 'HelpDesk',
        fields: ROW_FIELDS,
        where: [...conditions, `createdtime > ${literal(after)}`].join(' AND '),
        orderBy: { field: 'createdtime', direction: 'DESC' },
        limit,
      });
      for (const r of rows) {
        const created = crmTimeOf(r.createdtime);
        // The CRM's own comparison decides "after"; "up to" is checked here (a ticket created
        // while the check runs belongs to the next one).
        if (!created || created <= after || (options.upTo && created > options.upTo)) continue;
        found.set(str(r.id), r);
      }
    }
    const rows = [...found.values()].sort((a, b) => str(b.createdtime).localeCompare(str(a.createdtime))).slice(0, limit);
    const names = await this.contactNames(owner, rows.map((r) => refId(r.contact_id)));
    return rows.map((r) => this.row(r, schema, me, groups, names));
  }

  /** Contacts' names in one query (Contacts can be searched by id; organizations cannot, plan 2.1). */
  private async contactNames(owner: Owner, ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    try {
      const rows = await this.crm.select(owner, {
        module: 'Contacts',
        fields: ['firstname', 'lastname'],
        where: `id IN (${unique.map(idLiteral).join(', ')})`,
        limit: MAX_ROWS,
      });
      return new Map(rows.map((r) => [str(r.id), nameOf(r)]));
    } catch (error) {
      if (error instanceof CrmError && (error.kind === 'failed' || error.kind === 'denied')) return this.names(owner, unique);
      throw error;
    }
  }

  private row(r: Record<string, unknown>, schema: TicketSchema, me: string, groups: Map<string, string>, names: Map<string, string>): TicketRow {
    const label = (field: string) => {
      const value = str(r[field]);
      return schema.module.fields.find((f) => f.name === field)?.picklist.find((p) => p.value === value)?.label ?? value;
    };
    const ref = (id: string): Ref | null => (id ? { id, name: names.get(id) ?? null } : null);
    const status = str(r.ticketstatus);
    return {
      id: str(r.id),
      number: str(r.ticket_no),
      title: str(r.ticket_title),
      status: label('ticketstatus'),
      statusIndex: schema.statusField?.picklist.findIndex((p) => p.value === status) ?? -1,
      priority: label('ticketpriorities'),
      category: label('ticketcategories'),
      createdAt: crmInstant(r.createdtime),
      modifiedAt: crmInstant(r.modifiedtime),
      owner: this.who(refId(r.assigned_user_id), me, groups),
      organization: ref(refId(r.parent_id)),
      contact: ref(refId(r.contact_id)),
      closed: status !== '' && schema.closedStatuses.includes(status),
    };
  }

  /** The ticket, when the id is one of the user's CRM's tickets and they may read it; else 404. */
  private async ticket(owner: Owner, id: string, schema: TicketSchema): Promise<Record<string, unknown>> {
    const prefix = schema.module.idPrefix;
    if (!isRecordId(id) || (prefix && !id.startsWith(`${prefix}x`))) throw notFound('Ticket', id);
    const ticket = await this.crm.retrieve(owner, id);
    if (!ticket) throw notFound('Ticket', id);
    return ticket;
  }

  private async related(owner: Owner, id: string, module: 'ModComments' | 'Documents'): Promise<Array<Record<string, unknown>>> {
    try {
      const rows = await this.crm.read(owner, 'retrieve_related', { id, relatedType: module, relatedLabel: module });
      return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
    } catch (error) {
      // Not every CRM has retrieve_related, or every relation: the ticket shows without them.
      if (error instanceof CrmError && (error.kind === 'failed' || error.kind === 'denied' || error.kind === 'not-found')) return [];
      throw error;
    }
  }

  /** One ticket (plan 3.3): header, cleaned description and solution with their HTML, fields, comments, documents. */
  async detail(owner: Owner, id: string): Promise<TicketDetail> {
    const schema = await this.schema(owner);
    const [ticket, groups, me, crmUrl, comments, documents] = await Promise.all([
      this.ticket(owner, id, schema),
      this.groups(owner),
      this.crm.crmUserId(owner),
      this.crm.crmUrl(owner),
      this.related(owner, id, 'ModComments'),
      this.related(owner, id, 'Documents'),
    ]);

    // The fields shown, and the names behind the references among them.
    const listed = schema.module.fields.filter(
      (f) => !NOT_LISTED.has(f.name) && f.name !== schema.description && f.name !== schema.solution && str(ticket[f.name]).trim() !== '',
    );
    const references = listed.filter((f) => f.type === 'reference').map((f) => refId(ticket[f.name]));
    const customers = comments.map((c) => refId(c.customer));
    const names = await this.names(owner, [refId(ticket.parent_id), refId(ticket.contact_id), ...references, ...customers]);

    const text = (field: string | null) => {
      if (!field) return null;
      const html = str(ticket[field]);
      return html.trim() ? { ...cleanMail(html), html } : null;
    };
    const description = text(schema.description);
    const fields: Field[] = listed
      .map((f) => {
        const raw = str(ticket[f.name]);
        let value = raw;
        if (f.type === 'picklist') value = f.picklist.find((p) => p.value === raw)?.label ?? raw;
        else if (f.type === 'boolean') value = raw === '1' ? 'Yes' : raw === '0' ? 'No' : raw;
        else if (f.type === 'reference') value = names.get(refId(raw)) ?? '';
        else if (f.type === 'datetime') value = crmInstant(raw) ?? raw;
        else if (f.type === 'text') value = cleanMail(raw, 2_000).text;
        return { name: f.name, label: f.label.trim(), value };
      })
      .filter((f) => f.value !== '' && !(f.name.startsWith('cf_') && f.value === '0'));

    const sorted = [...comments].sort((a, b) => str(a.createdtime).localeCompare(str(b.createdtime)));
    return {
      ...this.row(ticket, schema, me, groups, names),
      crmLink: `${crmUrl}/index.php?module=HelpDesk&view=Detail&record=${id.split('x')[1]}`,
      description,
      solution: text(schema.solution),
      fields,
      comments: sorted.map((c, index) => {
        const html = str(c.commentcontent);
        const body = cleanMail(html);
        const customer = refId(c.customer);
        const creator = refId(c.creator) || refId(c.assigned_user_id);
        const author: Who = customer
          ? { kind: 'customer', id: customer, name: names.get(customer) ?? '' }
          : creator === me
            ? { kind: 'me' }
            : creator
              ? (() => {
                  const signedAs = signerOf(html);
                  return signedAs ? { kind: 'colleague' as const, signedAs } : { kind: 'colleague' as const };
                })()
              : { kind: 'nobody' };
        return {
          id: str(c.id),
          at: crmInstant(c.createdtime),
          author,
          private: !['', '0', 'false'].includes(str(c.is_private).trim()),
          body,
          html,
          files: this.fileIds(c),
          sameAsDescription: index === 0 && description !== null && body.text !== '' && body.text === description.text,
        };
      }),
      documents: documents.map((d) => ({
        id: str(d.id),
        title: str(d.notes_title),
        fileName: str(d.filename),
        files: this.fileIds(d),
      })),
    };
  }

  private fileIds(record: Record<string, unknown>): string[] {
    return str(record.imageattachmentids)
      .split(/[,;\s]+/)
      .map((x) => x.trim())
      .filter(isRecordId);
  }

  /** Every attachment id of a ticket, with what it belongs to: the only files its routes serve. */
  private async ticketFiles(owner: Owner, id: string): Promise<Map<string, Attachment['from']>> {
    await this.ticket(owner, id, await this.schema(owner));
    const [comments, documents] = await Promise.all([this.related(owner, id, 'ModComments'), this.related(owner, id, 'Documents')]);
    const files = new Map<string, Attachment['from']>();
    for (const c of comments) for (const f of this.fileIds(c)) files.set(f, { kind: 'comment', id: str(c.id) });
    for (const d of documents) for (const f of this.fileIds(d)) files.set(f, { kind: 'document', id: str(d.id) });
    return files;
  }

  /** The ticket's attachments, measured (plan 3.6, 3.7): downloaded from the CRM to read them, not kept. */
  async attachments(owner: Owner, id: string): Promise<Attachment[]> {
    const [files, marks] = await Promise.all([this.ticketFiles(owner, id), repo.listMarks(this.pool, owner)]);
    const found = await Promise.all(
      [...files].slice(0, 60).map(async ([fileId, from]) => {
        const file = await this.crm.file(owner, fileId);
        if (!file) return null;
        const type = sniffType(file.data, file.name);
        const print = type.startsWith('image/') ? await printOf(file.data) : null;
        const mark = print ? markFor(print, marks) : null;
        const attachment: Attachment = {
          id: fileId,
          name: file.name,
          type,
          size: file.data.length,
          inline: opensInline(type),
          width: print?.width ?? null,
          height: print?.height ?? null,
          from,
          signature: mark ? mark === 'logo' : print ? looksLikeLogo(file.data.length, print) : false,
          mark,
        };
        return attachment;
      }),
    );
    return found.filter((a): a is Attachment => a !== null);
  }

  /** One attachment's bytes, when it belongs to the ticket. */
  async file(owner: Owner, id: string, fileId: string): Promise<{ name: string; type: string; inline: boolean; data: Buffer }> {
    const files = await this.ticketFiles(owner, id);
    if (!files.has(fileId)) throw notFound('Attachment', fileId);
    const file = await this.crm.file(owner, fileId);
    if (!file) throw notFound('Attachment', fileId);
    const type = sniffType(file.data, file.name);
    return { name: file.name, type, inline: opensInline(type), data: file.data };
  }

  /** The user marks one of the ticket's images as a logo or a photo, or takes the mark back (null). */
  async mark(owner: Owner, id: string, fileId: string, mark: Mark | null): Promise<Attachment['mark']> {
    const file = await this.file(owner, id, fileId);
    const print = file.type.startsWith('image/') ? await printOf(file.data) : null;
    if (!print) throw badRequest('Only images can be marked', 'mark');
    if (mark) {
      await repo.saveMark(this.pool, owner, print, mark);
    } else {
      // Its own mark, and those that reach it by likeness.
      const marks = await repo.listMarks(this.pool, owner);
      const reaching = marks.filter((m) => m.exact === print.exact || markFor(print, [m]) !== null).map((m) => m.exact);
      await repo.deleteMarks(this.pool, owner, reaching);
    }
    return mark;
  }

  /** Contacts whose name or mail has the words (plan 3.2: the customer filter; the CRM lets few search organizations). */
  async customers(owner: Owner, q: string): Promise<Array<{ id: string; name: string; email: string; organization: Ref | null }>> {
    const words = q.trim();
    if (words.length < 2) return [];
    const fields = words.includes('@') ? ['email'] : ['lastname', 'firstname'];
    const results = await Promise.all(
      fields.map((field) =>
        this.crm.select(owner, {
          module: 'Contacts',
          fields: ['firstname', 'lastname', 'email', 'account_id'],
          where: `${field} LIKE ${containsLiteral(words)}`,
          orderBy: { field: 'lastname', direction: 'ASC' },
          limit: 10,
        }),
      ),
    );
    const contacts = [...new Map(results.flat().map((c) => [str(c.id), c])).values()].slice(0, 15);
    const organizations = await this.names(owner, contacts.map((c) => refId(c.account_id)));
    return contacts.map((c) => {
      const organization = refId(c.account_id);
      return {
        id: str(c.id),
        name: [str(c.firstname), str(c.lastname)].filter(Boolean).join(' '),
        email: str(c.email),
        organization: organization ? { id: organization, name: organizations.get(organization) ?? null } : null,
      };
    });
  }

  /**
   * Closed tickets that may be the same problem (plan 4.6): the title's words searched in the
   * titles and solutions of the closed tickets (one query per word and field: the CRM's VTQL has no
   * OR between different conditions, nor parentheses), ranked by how many words they share. Read
   * from the CRM now; nothing indexed or kept.
   */
  async similarClosed(owner: Owner, ticket: { id: string; title: string }): Promise<SimilarTicket[]> {
    const schema = await this.schema(owner);
    const words = searchWords(ticket.title);
    if (words.length === 0 || schema.closedStatuses.length === 0) return [];
    const closed = `ticketstatus IN (${schema.closedStatuses.map(literal).join(', ')})`;
    const fields = ['ticket_no', 'ticket_title', 'modifiedtime', ...(schema.solution ? [schema.solution] : [])];
    const searchIn = ['ticket_title', ...(schema.solution ? [schema.solution] : [])];
    const lookups = new Semaphore(4);
    const found = await Promise.all(
      words.flatMap((word) =>
        searchIn.map((field) =>
          lookups.run(() =>
            this.crm
              .select(owner, {
                module: 'HelpDesk',
                fields,
                where: `${field} LIKE ${containsLiteral(word)} AND ${closed}`,
                orderBy: { field: 'modifiedtime', direction: 'DESC' },
                limit: 20,
              })
              .catch((error: unknown) => {
                if (error instanceof CrmError && (error.kind === 'failed' || error.kind === 'denied')) return [];
                throw error;
              }),
          ),
        ),
      ),
    );
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of found.flat()) if (str(row.id) !== ticket.id) byId.set(str(row.id), row);
    return [...byId.values()]
      .map((row) => {
        const solution = schema.solution ? cleanMail(str(row[schema.solution]), 800).text : '';
        const text = `${str(row.ticket_title)} ${solution}`.toLowerCase();
        return {
          id: str(row.id),
          number: str(row.ticket_no),
          title: str(row.ticket_title),
          solution,
          closedAt: crmInstant(row.modifiedtime),
          score: words.filter((w) => text.includes(w)).length,
        };
      })
      .sort((a, b) => b.score - a.score || String(b.closedAt).localeCompare(String(a.closedAt)))
      .slice(0, 5);
  }

  /**
   * The ticket's photos for the AI (plan 4.5): its images that are not signature logos, the
   * heaviest 6, each made a JPEG of at most 1536 px. Sent only when the user asks for them.
   */
  async photosForAi(owner: Owner, id: string): Promise<Array<{ name: string; data: string }>> {
    const photos = (await this.attachments(owner, id))
      .filter((a) => a.type.startsWith('image/') && a.inline && !a.signature)
      .sort((a, b) => b.size - a.size)
      .slice(0, 6);
    const ready = await Promise.all(
      photos.map(async (photo) => {
        const file = await this.crm.file(owner, photo.id);
        if (!file) return null;
        try {
          const jpeg = await sharp(file.data, { failOn: 'none', animated: false })
            .rotate()
            .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          return { name: photo.name, data: jpeg.toString('base64') };
        } catch {
          return null;
        }
      }),
    );
    return ready.filter((p): p is { name: string; data: string } => p !== null);
  }
}
