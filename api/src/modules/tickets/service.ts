import type { Pool } from '../../db/pool.js';
import { badRequest, notFound } from '../../shared/errors.js';
import type { Owner } from '../../shared/owner.js';
import { Semaphore, type CrmClient } from '../crm/client.js';
import { containsLiteral, idLiteral, isRecordId, literal, MAX_ROWS } from '../crm/vtql.js';
import { CrmError } from '../crm/webservice.js';
import { looksLikeLogo, markFor, opensInline, printOf, sniffType, type Mark } from './files.js';
import { cleanMail, type CleanText } from './mail.js';
import * as repo from './repository.js';
import { ticketSchema, type TicketSchema } from './schema.js';

/**
 * The tickets, read from the user's CRM at every request (plan 3): folders, the list, a ticket, its
 * attachments. Nothing of the CRM is kept: the names behind the ids are read again each time, one
 * `retrieve` per distinct id, a few at once.
 */

/** Who a ticket is assigned to, or who wrote a comment, as the user may know them. */
export type Who =
  | { kind: 'me' }
  | { kind: 'group'; name: string }
  | { kind: 'customer'; id: string; name: string }
  /** A user of the CRM other than the user: their names cannot be read with a user's key (plan 2.1). */
  | { kind: 'colleague' }
  | { kind: 'nobody' };

export interface Ref {
  id: string;
  /** Null in a list: an organization's name costs a `retrieve` (~100 ms, plan 3), read later through /api/names. */
  name: string | null;
}

export interface Folder {
  id: string;
  label: string;
  /** What the folders are grouped by, for the page: the user's, the groups', all, one per picklist. */
  section: string;
}

export interface TicketRow {
  id: string;
  number: string;
  title: string;
  status: string;
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
  folder?: string;
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

  private openCondition(schema: TicketSchema): string | null {
    return schema.openStatuses.length > 0 ? `ticketstatus IN (${schema.openStatuses.map(literal).join(', ')})` : null;
  }

  /** A folder's conditions (joined with AND: the CRM's VTQL has no parentheses, plan 3). */
  private folderConditions(folder: string, schema: TicketSchema, me: string, groups: Map<string, string>): string[] | null {
    const open = this.openCondition(schema);
    const closed = schema.closedStatuses.length > 0 ? `ticketstatus IN (${schema.closedStatuses.map(literal).join(', ')})` : null;
    const mine = `assigned_user_id = ${idLiteral(me)}`;
    switch (folder) {
      case 'mine-open':
        return [mine, ...(open ? [open] : [])];
      case 'mine-closed':
        return [mine, ...(closed ? [closed] : [])];
      case 'open':
        return open ? [open] : [];
      case 'all':
        return [];
    }
    if (folder.startsWith('group:')) {
      const id = folder.slice('group:'.length);
      if (!groups.has(id)) return null;
      return [`assigned_user_id = ${idLiteral(id)}`, ...(open ? [open] : [])];
    }
    if (folder.startsWith('pick:')) {
      const [, field, ...rest] = folder.split(':');
      const value = rest.join(':');
      const picklist = schema.folderFields.find((f) => f.name === field);
      if (!picklist || !picklist.picklist.some((p) => p.value === value)) return null;
      return [`${picklist.name} = ${literal(value)}`, ...(open ? [open] : [])];
    }
    return null;
  }

  /** The folders (plan 3.1) and the statuses a ticket can have (the list's filter). */
  async foldersAndStatuses(owner: Owner): Promise<{ folders: Folder[]; statuses: Array<{ value: string; label: string; closed: boolean }> }> {
    const [folders, schema] = await Promise.all([this.folders(owner), this.schema(owner)]);
    const statuses = schema.module.fields.find((f) => f.name === 'ticketstatus')?.picklist ?? [];
    return { folders, statuses: statuses.map((s) => ({ ...s, closed: schema.closedStatuses.includes(s.value) })) };
  }

  /** The folders: the user's, each group's queue, everything, one per category and support group. */
  async folders(owner: Owner): Promise<Folder[]> {
    const [schema, groups] = await Promise.all([this.schema(owner), this.groups(owner)]);
    return [
      { id: 'mine-open', label: 'My open tickets', section: 'Mine' },
      { id: 'mine-closed', label: 'My closed tickets', section: 'Mine' },
      ...[...groups].map(([id, name]) => ({ id: `group:${id}`, label: name, section: 'Group queues' })),
      { id: 'open', label: 'All open tickets', section: 'All' },
      { id: 'all', label: 'All tickets', section: 'All' },
      ...schema.folderFields.flatMap((field) =>
        field.picklist.map((p) => ({ id: `pick:${field.name}:${p.value}`, label: p.label, section: field.label.trim() })),
      ),
    ];
  }

  /** How many tickets each folder has (one count each: ~1 s for two dozen folders, so apart from the folders). */
  async folderCounts(owner: Owner): Promise<Record<string, number | null>> {
    const [folders, schema, groups, me] = await Promise.all([this.folders(owner), this.schema(owner), this.groups(owner), this.crm.crmUserId(owner)]);
    const counting = new Semaphore(4);
    const counts = await Promise.all(
      folders.map(async (folder) => {
        const conditions = this.folderConditions(folder.id, schema, me, groups) ?? [];
        const count = await counting
          .run(() => this.crm.count(owner, 'HelpDesk', conditions.join(' AND ') || undefined))
          .catch((error: unknown) => {
            if (error instanceof CrmError && (error.kind === 'failed' || error.kind === 'denied')) return null;
            throw error;
          });
        return [folder.id, count] as const;
      }),
    );
    return Object.fromEntries(counts);
  }

  /** A page of a folder (plan 3.2): search, status, customer, sort, paging; the total with it. */
  async list(owner: Owner, query: ListQuery): Promise<TicketPage> {
    const [schema, groups, me] = await Promise.all([this.schema(owner), this.groups(owner), this.crm.crmUserId(owner)]);
    const conditions = this.folderConditions(query.folder ?? 'mine-open', schema, me, groups);
    if (!conditions) throw badRequest(`No folder "${query.folder}"`, 'folder');
    const q = (query.q ?? '').trim();
    if (q) conditions.push(`${looksLikeNumber(q) ? 'ticket_no' : 'ticket_title'} LIKE ${containsLiteral(q)}`);
    if (query.status) {
      if (!schema.module.fields.find((f) => f.name === 'ticketstatus')?.picklist.some((p) => p.value === query.status)) {
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
              ? { kind: 'colleague' }
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
}
