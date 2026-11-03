import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

/** Who is signed in on this browser (design-accounts.md, "session"). */
export interface SessionUser {
  id: number;
  username: string;
  role: 'user' | 'admin';
  /** The administrator acting as this user (impersonation), or null. */
  impersonatedBy: number | null;
}

/** The session as the API answers it (Better Auth's shape, the token taken out by the API). */
interface SessionBody {
  user: { id: string | number; username: string; role?: string | null };
  session: { impersonatedBy?: string | number | null };
}

function toSessionUser(body: SessionBody | null): SessionUser | null {
  if (!body?.user) return null;
  return {
    id: Number(body.user.id),
    username: body.user.username,
    role: body.user.role === 'admin' ? 'admin' : 'user',
    impersonatedBy: body.session?.impersonatedBy ? Number(body.session.impersonatedBy) : null,
  };
}

/** Gateway of the sign-in endpoints (/api/auth): one method per operation, no state, no logic. */
@Injectable({
  providedIn: 'root',
})
export class AuthApi {
  private readonly http = inject(HttpClient);

  /** GET /api/auth/get-session: who this browser is signed in as, or null. */
  getSession(): Observable<SessionUser | null> {
    return this.http.get<SessionBody | null>('/api/auth/get-session').pipe(map(toSessionUser));
  }

  /** POST /api/auth/sign-in/username: the session cookie comes with the answer. */
  signIn(username: string, password: string): Observable<void> {
    return this.http.post<unknown>('/api/auth/sign-in/username', { username, password }).pipe(map(() => undefined));
  }

  /** POST /api/auth/sign-out: the session ends here and its cookie goes. */
  signOut(): Observable<void> {
    return this.http.post<unknown>('/api/auth/sign-out', {}).pipe(map(() => undefined));
  }

  /** POST /api/auth/revoke-other-sessions: every other session of the user ends; this one stays. */
  revokeOtherSessions(): Observable<void> {
    return this.http.post<unknown>('/api/auth/revoke-other-sessions', {}).pipe(map(() => undefined));
  }

  /** POST /api/auth/admin/stop-impersonating: the administrator's own session comes back. */
  stopImpersonating(): Observable<void> {
    return this.http.post<unknown>('/api/auth/admin/stop-impersonating', {}).pipe(map(() => undefined));
  }
}
