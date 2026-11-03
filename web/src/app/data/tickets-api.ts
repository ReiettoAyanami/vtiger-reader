import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  Attachment,
  CustomerHit,
  FolderCounts,
  FoldersAndStatuses,
  ListQuery,
  Mark,
  TicketDetail,
  TicketPage,
} from './tickets';

/** Gateway of the tickets (/api/tickets, read-only): one method per operation, no state, no logic. */
@Injectable({
  providedIn: 'root',
})
export class TicketsApi {
  private readonly http = inject(HttpClient);

  /** GET /api/tickets/folders: the folders and the statuses. */
  folders(): Observable<FoldersAndStatuses> {
    return this.http.get<FoldersAndStatuses>('/api/tickets/folders');
  }

  /** GET /api/tickets/folders/counts: one CRM count per folder (~1 s), apart from the folders. */
  folderCounts(): Observable<FolderCounts> {
    return this.http.get<FolderCounts>('/api/tickets/folders/counts');
  }

  /** GET /api/tickets: a page of a folder. */
  list(query: ListQuery): Observable<TicketPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '' && value !== null)
        params = params.set(key, String(value));
    }
    return this.http.get<TicketPage>('/api/tickets', { params });
  }

  /** GET /api/names: the names behind record ids (a list's organizations). */
  names(ids: string[]): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>('/api/names', { params: { ids: ids.join(',') } });
  }

  /** GET /api/tickets/:id */
  ticket(id: string): Observable<TicketDetail> {
    return this.http.get<TicketDetail>(`/api/tickets/${encodeURIComponent(id)}`);
  }

  /** GET /api/tickets/:id/attachments: measured from their bytes (slower than the ticket). */
  attachments(id: string): Observable<Attachment[]> {
    return this.http.get<Attachment[]>(`/api/tickets/${encodeURIComponent(id)}/attachments`);
  }

  /** The address of an attachment, inline (images, PDFs) or as a download. */
  fileUrl(id: string, fileId: string, download = false): string {
    return `/api/tickets/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}${download ? '?download=true' : ''}`;
  }

  /** An attachment's bytes (the Raw view puts images in the mail itself). */
  file(id: string, fileId: string): Observable<Blob> {
    return this.http.get(this.fileUrl(id, fileId), { responseType: 'blob' });
  }

  /** PUT /api/tickets/:id/files/:fileId/mark: logo, photo, or null to take the mark back. */
  mark(id: string, fileId: string, mark: Mark | null): Observable<{ mark: Mark | null }> {
    return this.http.put<{ mark: Mark | null }>(
      `/api/tickets/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}/mark`,
      { mark },
    );
  }

  /** GET /api/customers: contacts by name or mail. */
  customers(q: string): Observable<CustomerHit[]> {
    return this.http.get<CustomerHit[]>('/api/customers', { params: { q } });
  }
}
