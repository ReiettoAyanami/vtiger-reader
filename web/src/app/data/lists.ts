/** One of the user's own lists of tickets (api/src/modules/lists/filter.ts). */
export interface ListFilter {
  /** Whose tickets: mine, anyone's, any group's ("unassigned"), or one group's. */
  owner: 'me' | 'anyone' | 'groups' | 'group';
  group?: string;
  /** Still to handle, finished, any, or one status. */
  status: 'open' | 'closed' | 'any' | 'one';
  statusValue?: string;
  /** Other picklists: field → value (category, support group, priority). */
  picks?: Record<string, string>;
}

export interface TicketList {
  id: number;
  name: string;
  filter: ListFilter;
}

/** GET /api/lists/counts: tickets per list id; null when it could not be counted. */
export type ListCounts = Record<string, number | null>;
