import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { CreateUserInput, User, UserUpdate } from './user';

/** Gateway of the admin view's endpoints (/api/admin): one method per operation, no state, no logic. */
@Injectable({
  providedIn: 'root',
})
export class AdminApi {
  private readonly http = inject(HttpClient);

  /** GET /api/admin/users: every user, by username. */
  listUsers(): Observable<User[]> {
    return this.http.get<User[]>('/api/admin/users');
  }

  /** POST /api/admin/users: the new user, ready to use. */
  createUser(input: CreateUserInput): Observable<User> {
    return this.http.post<User>('/api/admin/users', input);
  }

  /** PATCH /api/admin/users/:id: the user as it is now. */
  updateUser(id: number, changes: UserUpdate): Observable<User> {
    return this.http.patch<User>(`/api/admin/users/${id}`, changes);
  }

  /** DELETE /api/admin/users/:id: the user and everything of theirs, for good. */
  deleteUser(id: number): Observable<void> {
    return this.http.delete<void>(`/api/admin/users/${id}`);
  }

  /** POST /api/admin/users/:id/impersonate: this browser's session becomes the user's. */
  impersonate(id: number): Observable<void> {
    return this.http.post<unknown>(`/api/admin/users/${id}/impersonate`, {}).pipe(map(() => undefined));
  }

  /** GET /api/admin/generated-password: a password that follows the rules, for the user form. */
  generatedPassword(): Observable<string> {
    return this.http.get<{ password: string }>('/api/admin/generated-password').pipe(map((body) => body.password));
  }
}
