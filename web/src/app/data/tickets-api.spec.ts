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

  it('lists a folder, sending only the filters that are set', async () => {
    const result = firstValueFrom(
      api.list({ folder: 'mine-open', q: '', status: 'Open', page: 0, contact: undefined }),
    );
    const req = backend.expectOne((r) => r.url === '/api/tickets');
    expect(req.request.params.keys().sort()).toEqual(['folder', 'page', 'status']);
    expect(req.request.params.get('folder')).toBe('mine-open');
    req.flush({ items: [], page: 0, size: 50, total: 0 });
    expect((await result).total).toBe(0);
  });

  it('folders, counts, names, a ticket, its attachments, customers', async () => {
    void firstValueFrom(api.folders());
    backend.expectOne('/api/tickets/folders').flush({ folders: [], statuses: [] });
    void firstValueFrom(api.folderCounts());
    backend.expectOne('/api/tickets/folders/counts').flush({});
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
