import type { Pool } from '../../db/pool.js';
import { badRequest, notFound } from '../../shared/errors.js';
import type { Owner } from '../../shared/owner.js';
import { normalizeFilter, type ListFilter, type TicketList } from './filter.js';
import * as repo from './repository.js';

export interface ListInput {
  name: string;
  filter: ListFilter;
}

/** At most this many lists per user. */
export const MAX_LISTS = 50;

/**
 * The user's lists: theirs only (another user's list is not found). The values a filter names
 * (a status, a group, a category) are checked against the CRM when the list is read
 * (tickets/service.ts), since the CRM can change them.
 */
export class ListsService {
  constructor(private readonly pool: Pool) {}

  async all(owner: Owner): Promise<TicketList[]> {
    return repo.listLists(this.pool, owner);
  }

  async get(owner: Owner, id: number): Promise<TicketList> {
    const list = await repo.findList(this.pool, owner, id);
    if (!list) throw notFound('List', id);
    return list;
  }

  /** The list a page asks for, or the user's first one. */
  async getOrFirst(owner: Owner, id: number | undefined): Promise<TicketList | null> {
    if (id !== undefined) return this.get(owner, id);
    return (await this.all(owner))[0] ?? null;
  }

  async create(owner: Owner, input: ListInput): Promise<TicketList> {
    const { name, filter } = this.checked(input);
    if ((await this.all(owner)).length >= MAX_LISTS) throw badRequest(`At most ${MAX_LISTS} lists`);
    const id = await repo.insertList(this.pool, owner, name, filter);
    return this.get(owner, id);
  }

  async update(owner: Owner, id: number, input: ListInput): Promise<TicketList> {
    const { name, filter } = this.checked(input);
    if (!(await repo.updateList(this.pool, owner, id, name, filter))) {
      // Unchanged rows count as not affected: it may still be there.
      await this.get(owner, id);
    }
    return this.get(owner, id);
  }

  /** Every one of the user's lists, in a new order. */
  async reorder(owner: Owner, ids: readonly number[]): Promise<TicketList[]> {
    const current = (await this.all(owner)).map((l) => l.id).sort((a, b) => a - b);
    const asked = [...ids].sort((a, b) => a - b);
    if (current.length !== asked.length || current.some((id, i) => id !== asked[i])) {
      throw badRequest('The order must name each of your lists once', 'ids');
    }
    await repo.reorderLists(this.pool, owner, ids);
    return this.all(owner);
  }

  async remove(owner: Owner, id: number): Promise<void> {
    if (!(await repo.deleteList(this.pool, owner, id))) throw notFound('List', id);
  }

  private checked(input: ListInput): ListInput {
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (!name) throw badRequest('Required', 'name');
    const filter = normalizeFilter(input.filter);
    if (input.filter.owner === 'group' && !filter.group) throw badRequest('Choose the group', 'filter.group');
    if (input.filter.status === 'one' && !filter.statusValue) throw badRequest('Choose the status', 'filter.statusValue');
    if (filter.picks && 'ticketstatus' in filter.picks) throw badRequest('The status has its own choice', 'filter.picks');
    return { name, filter };
  }
}
