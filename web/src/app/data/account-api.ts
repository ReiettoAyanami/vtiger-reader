import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

/** Gateway of the signed-in user's own account (/api/account): one method per operation, no state, no logic. */
@Injectable({
  providedIn: 'root',
})
export class AccountApi {
  private readonly http = inject(HttpClient);

  /** POST /api/account/password: 204; this session stays, the user's other ones close. */
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>('/api/account/password', { currentPassword, newPassword }).pipe(map(() => undefined));
  }
}
