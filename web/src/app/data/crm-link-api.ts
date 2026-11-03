import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { CrmLinkInput, CrmLinkStatus } from './crm-link';

/** Gateway of the user's CRM link (/api/crm/link): one method per operation, no state, no logic. */
@Injectable({
  providedIn: 'root',
})
export class CrmLinkApi {
  private readonly http = inject(HttpClient);

  /** GET /api/crm/link */
  getLink(): Observable<CrmLinkStatus> {
    return this.http.get<CrmLinkStatus>('/api/crm/link');
  }

  /** PUT /api/crm/link: the server logs in with them first; saved only when the CRM accepts them. */
  link(input: CrmLinkInput): Observable<CrmLinkStatus> {
    return this.http.put<CrmLinkStatus>('/api/crm/link', input);
  }

  /** DELETE /api/crm/link: 204. */
  unlink(): Observable<void> {
    return this.http.delete<void>('/api/crm/link').pipe(map(() => undefined));
  }
}
