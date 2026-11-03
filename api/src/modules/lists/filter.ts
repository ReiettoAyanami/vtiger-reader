/**
 * A user's own list of tickets (lenzi, 2026-11-03: "the lists should be a relation to the user
 * itself"): which tickets it shows, as a preference. The CRM's own saved lists cannot be read
 * with an access key (plan 2.1, crm-spike.md), so each user makes theirs here; nothing of the CRM
 * is stored but the values the filter names (a group's id, a category's value).
 */
export interface ListFilter {
  /** Whose tickets: mine, anyone's, a group's (any group: "unassigned"), or one group's. */
  owner: 'me' | 'anyone' | 'groups' | 'group';
  /** owner = group: the group's CRM id (20x5). */
  group?: string;
  /** Still to handle, finished, any, or one status. */
  status: 'open' | 'closed' | 'any' | 'one';
  /** status = one: the status's value. */
  statusValue?: string;
  /** Other picklists of the ticket: field → value (category, support group, priority). */
  picks?: Record<string, string>;
}

export interface TicketList {
  id: number;
  name: string;
  filter: ListFilter;
}

/** The lists every user starts with: those of the CRM's own "Miei ticket"... (lenzi's, 2026-11-03). */
export const DEFAULT_LISTS: ReadonlyArray<{ name: string; filter: ListFilter }> = [
  { name: 'My tickets', filter: { owner: 'me', status: 'any' } },
  { name: 'My open tickets', filter: { owner: 'me', status: 'open' } },
  { name: 'My closed tickets', filter: { owner: 'me', status: 'closed' } },
  { name: 'Unassigned', filter: { owner: 'groups', status: 'open' } },
  { name: 'All open tickets', filter: { owner: 'anyone', status: 'open' } },
  { name: 'All tickets', filter: { owner: 'anyone', status: 'any' } },
];

/** The JSON schema of a filter, for the routes (the service checks the values against the CRM). */
export const listFilterSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['owner', 'status'],
  properties: {
    owner: { type: 'string', enum: ['me', 'anyone', 'groups', 'group'] },
    group: { type: 'string', pattern: '^\\d+x\\d+$', maxLength: 40 },
    status: { type: 'string', enum: ['open', 'closed', 'any', 'one'] },
    statusValue: { type: 'string', minLength: 1, maxLength: 200 },
    picks: {
      type: 'object',
      maxProperties: 6,
      propertyNames: { pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' },
      additionalProperties: { type: 'string', minLength: 1, maxLength: 200 },
    },
  },
} as const;

/** A filter as stored, made whole: what does not belong to its owner or status goes. */
export function normalizeFilter(filter: ListFilter): ListFilter {
  return {
    owner: filter.owner,
    ...(filter.owner === 'group' && filter.group ? { group: filter.group } : {}),
    status: filter.status,
    ...(filter.status === 'one' && filter.statusValue ? { statusValue: filter.statusValue } : {}),
    ...(filter.picks && Object.keys(filter.picks).length > 0 ? { picks: { ...filter.picks } } : {}),
  };
}

/** A stored filter read back: anything unexpected becomes "anyone, any status". */
export function parseFilter(raw: unknown): ListFilter {
  const value = (typeof raw === 'string' ? safeJson(raw) : raw) as Partial<ListFilter> | null;
  const owner = ['me', 'anyone', 'groups', 'group'].includes(String(value?.owner)) ? (value!.owner as ListFilter['owner']) : 'anyone';
  const status = ['open', 'closed', 'any', 'one'].includes(String(value?.status)) ? (value!.status as ListFilter['status']) : 'any';
  const picks =
    value?.picks && typeof value.picks === 'object'
      ? Object.fromEntries(Object.entries(value.picks).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : undefined;
  return normalizeFilter({
    owner,
    status,
    ...(typeof value?.group === 'string' ? { group: value.group } : {}),
    ...(typeof value?.statusValue === 'string' ? { statusValue: value.statusValue } : {}),
    ...(picks ? { picks } : {}),
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
