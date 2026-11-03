import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';

import { AuthApi } from '../data/auth-api';
import { Session } from './session';
import { sessionEndedInterceptor } from './session-ended-interceptor';

@Component({ template: '' })
class Blank {}

describe('sessionEndedInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let router: Router;
  let session: Session;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([sessionEndedInterceptor])),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'login', component: Blank },
          { path: 'lenzi/metrics', component: Blank },
        ]),
        { provide: AuthApi, useValue: { getSession: () => of({ id: 1, username: 'lenzi', role: 'user', impersonatedBy: null }) } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    session = TestBed.inject(Session);
    await session.load();
    await router.navigateByUrl('/lenzi/metrics?per=week');
  });

  afterEach(() => backend.verify());

  /** A GET of `url` that the server answers with `status`; resolves with what the caller got. */
  async function call(url: string, status: number) {
    const result = firstValueFrom(http.get(url)).then(
      () => 'ok',
      (error: { status: number }) => error.status,
    );
    backend.expectOne(url).flush(null, { status, statusText: 'x' });
    return result;
  }

  it('a 401 from the API: the session is over, to the sign-in page, which will come back here', async () => {
    expect(await call('/api/tickets', 401)).toBe(401);
    await vi.waitFor(() => expect(router.url).toBe('/login?next=%2Flenzi%2Fmetrics%3Fper%3Dweek'));

    expect(session.user()).toBeNull();
  });

  it('several 401s at once (a page asks for several things): one trip to the sign-in page', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl');
    const urls = ['/api/settings', '/api/tickets', '/api/admin/users'];
    const results = urls.map((url) => firstValueFrom(http.get(url)).catch((error: { status: number }) => error.status));
    for (const url of urls) backend.expectOne(url).flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(await Promise.all(results)).toEqual([401, 401, 401]);
    await vi.waitFor(() => expect(router.url).toBe('/login?next=%2Flenzi%2Fmetrics%3Fper%3Dweek'));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('a 401 from signing in is a wrong password, not an ended session', async () => {
    expect(await call('/api/auth/sign-in/username', 401)).toBe(401);
    await new Promise((resolve) => setTimeout(resolve));

    expect(router.url).toBe('/lenzi/metrics?per=week');
    expect(session.user()?.username).toBe('lenzi');
  });

  it('other failures pass through untouched', async () => {
    for (const status of [400, 403, 404, 409, 500]) expect(await call('/api/tickets', status)).toBe(status);
    await new Promise((resolve) => setTimeout(resolve));

    expect(router.url).toBe('/lenzi/metrics?per=week');
    expect(session.user()?.username).toBe('lenzi');
  });
});
