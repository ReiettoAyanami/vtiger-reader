import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ListCounts, ListFilter, TicketList } from './lists';

/** Gateway of the user's own lists (/api/lists): one method per operation, no state, no logic. */
@Injectable({
  providedIn: 'root',
})
export class ListsApi {
  private readonly http = inject(HttpClient);

  /** GET /api/lists, in the user's order. */
  lists(): Observable<TicketList[]> {
    return this.http.get<TicketList[]>('/api/lists');
  }

  /** GET /api/lists/counts: one CRM count per list (~1 s for a dozen), after the page. */
  counts(): Observable<ListCounts> {
    return this.http.get<ListCounts>('/api/lists/counts');
  }

  /** POST /api/lists: a new list, last. */
  create(name: string, filter: ListFilter): Observable<TicketList> {
    return this.http.post<TicketList>('/api/lists', { name, filter });
  }

  /** PUT /api/lists/:id */
  update(id: number, name: string, filter: ListFilter): Observable<TicketList> {
    return this.http.put<TicketList>(`/api/lists/${id}`, { name, filter });
  }

  /** PUT /api/lists/order: every list, in the new order. */
  reorder(ids: number[]): Observable<TicketList[]> {
    return this.http.put<TicketList[]>('/api/lists/order', { ids });
  }

  /** DELETE /api/lists/:id: 204. */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(`/api/lists/${id}`).pipe(map(() => undefined));
  }
}
