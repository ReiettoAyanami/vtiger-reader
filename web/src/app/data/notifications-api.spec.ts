import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { NotificationsApi } from './notifications-api';

describe('NotificationsApi', () => {
  let api: NotificationsApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(NotificationsApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('settings, bell, seen', async () => {
    const settings = firstValueFrom(api.settings());
    backend
      .expectOne({ method: 'GET', url: '/api/notifications/settings' })
      .flush({ enabled: true, lists: [1], devices: 0 });
    expect((await settings).lists).toEqual([1]);

    void firstValueFrom(api.updateSettings(false, [2, 3]));
    const put = backend.expectOne({ method: 'PUT', url: '/api/notifications/settings' });
    expect(put.request.body).toEqual({ enabled: false, lists: [2, 3] });
    put.flush({ enabled: false, lists: [2, 3], devices: 0 });

    void firstValueFrom(api.bell());
    backend
      .expectOne({ method: 'GET', url: '/api/notifications' })
      .flush({ enabled: true, items: [] });

    const seen = firstValueFrom(api.seen('2026-11-04T10:00:00Z'));
    const post = backend.expectOne({ method: 'POST', url: '/api/notifications/seen' });
    expect(post.request.body).toEqual({ upTo: '2026-11-04T10:00:00Z' });
    post.flush(null, { status: 204, statusText: 'No Content' });
    expect(await seen).toBeUndefined();
  });

  it('push: key, subscribe, unsubscribe, test', async () => {
    const key = firstValueFrom(api.publicKey());
    backend.expectOne({ method: 'GET', url: '/api/push/key' }).flush({ publicKey: 'BAbc' });
    expect(await key).toBe('BAbc');

    const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
    void firstValueFrom(api.subscribe(sub));
    const put = backend.expectOne({ method: 'PUT', url: '/api/push/subscription' });
    expect(put.request.body).toEqual(sub);
    put.flush(null, { status: 204, statusText: 'No Content' });

    void firstValueFrom(api.unsubscribe('https://push.example/1'));
    const del = backend.expectOne({ method: 'POST', url: '/api/push/subscription/delete' });
    expect(del.request.body).toEqual({ endpoint: 'https://push.example/1' });
    del.flush(null, { status: 204, statusText: 'No Content' });

    const sent = firstValueFrom(api.test());
    backend.expectOne({ method: 'POST', url: '/api/push/test' }).flush({ sent: 2 });
    expect(await sent).toBe(2);
  });
});
