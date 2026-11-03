import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { ListsApi } from './lists-api';

describe('ListsApi', () => {
  let api: ListsApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ListsApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('reads, creates, edits, orders and deletes the lists', async () => {
    void firstValueFrom(api.lists());
    backend.expectOne({ method: 'GET', url: '/api/lists' }).flush([]);
    void firstValueFrom(api.counts());
    backend.expectOne({ method: 'GET', url: '/api/lists/counts' }).flush({});
    void firstValueFrom(api.create('Mine', { owner: 'me', status: 'open' }));
    expect(backend.expectOne({ method: 'POST', url: '/api/lists' }).request.body).toEqual({
      name: 'Mine',
      filter: { owner: 'me', status: 'open' },
    });
    void firstValueFrom(api.update(3, 'Mine', { owner: 'me', status: 'any' }));
    backend.expectOne({ method: 'PUT', url: '/api/lists/3' }).flush({});
    void firstValueFrom(api.reorder([2, 1]));
    expect(backend.expectOne({ method: 'PUT', url: '/api/lists/order' }).request.body).toEqual({
      ids: [2, 1],
    });
    const removed = firstValueFrom(api.remove(3));
    backend
      .expectOne({ method: 'DELETE', url: '/api/lists/3' })
      .flush(null, { status: 204, statusText: 'No Content' });
    expect(await removed).toBeUndefined();
  });
});
