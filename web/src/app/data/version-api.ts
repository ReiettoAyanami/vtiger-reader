import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

/** What GET /api/version answers: the version, and the API level the Android app compares. */
export interface ServerVersion {
  version: string;
  apiLevel: number;
}

/** Gateway of the product's version: one method per API operation, no state, no logic. */
@Injectable({
  providedIn: 'root',
})
export class VersionApi {
  private readonly http = inject(HttpClient);

  /** GET /api/version: the version of the running instance, e.g. "dev26.0.0.0001". */
  getVersion(): Observable<string> {
    return this.http.get<{ version: string }>('/api/version').pipe(map((body) => body.version));
  }

  /**
   * GET /api/version with its API level, of this instance or of the server at `address` (an origin:
   * the Android app asks an address before keeping it).
   */
  getServerVersion(address = ''): Observable<ServerVersion> {
    return this.http.get<ServerVersion>(`${address}/api/version`);
  }
}
