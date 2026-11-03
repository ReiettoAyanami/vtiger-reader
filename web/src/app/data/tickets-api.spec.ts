import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { TicketsApi } from './tickets-api';

describe('TicketsApi', () => {
  let api: TicketsApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(TicketsApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('a page of a list, sending only the filters that are set', async () => {
    const result = firstValueFrom(
      api.list({ list: 7, q: '', status: 'Open', page: 0, contact: undefined }),
    );
    const req = backend.expectOne((r) => r.url === '/api/tickets');
    expect(req.request.params.keys().sort()).toEqual(['list', 'page', 'status']);
    expect(req.request.params.get('list')).toBe('7');
    req.flush({ items: [], page: 0, size: 50, total: 0 });
    expect((await result).total).toBe(0);
  });

  it('options, names, a ticket, its attachments, customers', async () => {
    void firstValueFrom(api.options());
    backend.expectOne('/api/tickets/options').flush({ statuses: [], groups: [], picklists: [] });
    void firstValueFrom(api.names(['11x1', '11x2']));
    expect(backend.expectOne((r) => r.url === '/api/names').request.params.get('ids')).toBe(
      '11x1,11x2',
    );
    void firstValueFrom(api.ticket('17x1'));
    backend.expectOne('/api/tickets/17x1').flush({});
    void firstValueFrom(api.attachments('17x1'));
    backend.expectOne('/api/tickets/17x1/attachments').flush([]);
    void firstValueFrom(api.customers('rossi'));
    expect(backend.expectOne((r) => r.url === '/api/customers').request.params.get('q')).toBe(
      'rossi',
    );
  });

  it('marks an image, or takes the mark back', async () => {
    const result = firstValueFrom(api.mark('17x1', '15x2', null));
    const req = backend.expectOne('/api/tickets/17x1/files/15x2/mark');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ mark: null });
    req.flush({ mark: null });
    expect(await result).toEqual({ mark: null });
  });

  it("a file's address: inline, or as a download", () => {
    expect(api.fileUrl('17x1', '15x2')).toBe('/api/tickets/17x1/files/15x2');
    expect(api.fileUrl('17x1', '15x2', true)).toBe('/api/tickets/17x1/files/15x2?download=true');
  });
});
