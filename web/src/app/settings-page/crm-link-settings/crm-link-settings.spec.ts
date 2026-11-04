import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { CrmLinkStatus } from '../../data/crm-link';
import { errorInterceptor } from '../../data/error-interceptor';
import { HistoryDialogs } from '../../history-dialogs';
import { CrmLinkSettings } from './crm-link-settings';

const CRM = 'https://crm.example.invalid';
const UNLINKED: CrmLinkStatus = {
  crmUrl: null,
  linked: false,
  username: null,
  linkedAt: null,
  lastLoginAt: null,
  problem: null,
};
const LINKED: CrmLinkStatus = {
  crmUrl: CRM,
  linked: true,
  username: 'mario.rossi',
  linkedAt: '2026-11-03T10:00:00.000Z',
  lastLoginAt: '2026-11-03T11:00:00.000Z',
  problem: null,
};

describe('CrmLinkSettings', () => {
  let backend: HttpTestingController;
  let snacks: string[];
  let confirmed: boolean;
  let dialogs: Array<{ title: string; action: () => unknown }>;

  async function render(status: CrmLinkStatus) {
    snacks = [];
    dialogs = [];
    confirmed = true;
    TestBed.configureTestingModule({
      imports: [CrmLinkSettings],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: HistoryDialogs,
          useValue: {
            // The dialog as the user answers it: Unlink runs the action, Cancel does not.
            open: async (_component: unknown, data: { title: string; action: () => unknown }) => {
              dialogs.push(data);
              if (!confirmed) return undefined;
              await firstValueFrom(data.action() as never);
              return true;
            },
          },
        },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(CrmLinkSettings);
    fixture.detectChanges();
    backend.expectOne({ method: 'GET', url: '/api/crm/link' }).flush(status);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const input = (field: string) =>
      element.querySelector<HTMLInputElement>(`input[formControlName="${field}"]`);
    const text = (selector: string) =>
      (element.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      element,
      input,
      text,
      settle: () => fixture.whenStable(),
      type: async (field: string, value: string) => {
        input(field)!.value = value;
        input(field)!.dispatchEvent(new Event('input'));
        await fixture.whenStable();
      },
      click: async (selector: string) => {
        element.querySelector<HTMLButtonElement>(selector)!.click();
        await fixture.whenStable();
      },
      errorUnder: (field: string) =>
        input(field)!.closest('mat-form-field')!.querySelector('mat-error')?.textContent?.trim(),
    };
  }

  afterEach(() => backend.verify());

  it('unlinked: asks for the CRM username and access key, the key hidden and kept out of password managers', async () => {
    const page = await render(UNLINKED);
    expect(page.input('username')).not.toBeNull();
    expect(page.input('accessKey')!.type).toBe('password');
    expect(page.input('accessKey')!.getAttribute('autocomplete')).toBe('off');
    expect(page.text('.note')).toContain('My Preferences → Access Key');
  });

  it('links: sends the three, trimmed, then shows the account', async () => {
    const page = await render(UNLINKED);
    expect(page.input('url')!.type).toBe('url');
    await page.type('url', ' https://crm.example.invalid ');
    await page.type('username', ' mario.rossi ');
    await page.type('accessKey', 'AbCdEf0123456789 ');
    await page.click('button[type="submit"]');
    const req = backend.expectOne({ method: 'PUT', url: '/api/crm/link' });
    expect(req.request.body).toEqual({
      url: 'https://crm.example.invalid',
      username: 'mario.rossi',
      accessKey: 'AbCdEf0123456789',
    });
    req.flush(LINKED);
    await vi.waitFor(() => expect(snacks).toEqual(['CRM account linked: mario.rossi']));
    await page.settle();
    expect(page.text('.linked')).toBe('Linked as mario.rossi to crm.example.invalid');
    expect(page.element.querySelector('form')).toBeNull();
  });

  it('a key the CRM refuses: the reason under the key, nothing linked', async () => {
    const page = await render(UNLINKED);
    await page.type('url', CRM);
    await page.type('username', 'mario.rossi');
    await page.type('accessKey', 'wrong');
    await page.click('button[type="submit"]');
    backend.expectOne('/api/crm/link').flush(
      {
        type: 'urn:vtiger-reader:problem:validation',
        title: 'Bad Request',
        status: 400,
        detail: 'The CRM did not accept this username and access key',
        errors: [
          { field: 'accessKey', message: 'The CRM did not accept this username and access key' },
        ],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await vi.waitFor(() =>
      expect(page.errorUnder('accessKey')).toBe(
        'The CRM did not accept this username and access key',
      ),
    );
    expect(snacks).toEqual([]);
  });

  it('an address that is not a public CRM: the reason under the address', async () => {
    const page = await render(UNLINKED);
    await page.type('url', 'https://192.168.1.10');
    await page.type('username', 'mario.rossi');
    await page.type('accessKey', 'AbCdEf0123456789');
    await page.click('button[type="submit"]');
    const message = 'Not a public https address: the server only calls CRMs on the internet';
    backend
      .expectOne('/api/crm/link')
      .flush(
        {
          type: 'urn:vtiger-reader:problem:validation',
          title: 'Bad Request',
          status: 400,
          detail: message,
          errors: [{ field: 'url', message }],
        },
        { status: 400, statusText: 'Bad Request' },
      );
    await vi.waitFor(() => expect(page.errorUnder('url')).toBe(message));
  });

  it('a server error: said above the button', async () => {
    const page = await render(UNLINKED);
    await page.type('url', CRM);
    await page.type('username', 'mario.rossi');
    await page.type('accessKey', 'AbCdEf0123456789');
    await page.click('button[type="submit"]');
    backend
      .expectOne('/api/crm/link')
      .flush(
        {
          type: 'urn:vtiger-reader:problem:crm-error',
          title: 'Bad Gateway',
          status: 502,
          detail: 'CRM: something broke',
          errors: [],
        },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await vi.waitFor(() =>
      expect(page.text('.form-error')).toBe(
        'Could not link the account: CRM: something broke (502)',
      ),
    );
  });

  it('sends nothing while a field is empty', async () => {
    const page = await render(UNLINKED);
    await page.click('button[type="submit"]');
    expect(page.errorUnder('url')).toBe('Required');
    expect(page.errorUnder('username')).toBe('Required');
    expect(page.errorUnder('accessKey')).toBe('Required');
  });

  it('linked: the account, the problem when there is one, Change account and Unlink', async () => {
    const page = await render({ ...LINKED, problem: 'The saved access key can no longer be read' });
    expect(page.text('.linked')).toBe('Linked as mario.rossi to crm.example.invalid');
    expect(page.text('.problem')).toBe('The saved access key can no longer be read');
    expect(page.element.querySelector('.change')).not.toBeNull();
    expect(page.element.querySelector('.unlink')).not.toBeNull();
  });

  it('Change account: the form with the address and the username filled in, and Cancel', async () => {
    const page = await render(LINKED);
    await page.click('.change');
    expect(page.input('url')!.value).toBe(CRM);
    expect(page.input('username')!.value).toBe('mario.rossi');
    expect(page.input('accessKey')!.value).toBe('');
    const cancel = [...page.element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Cancel',
    )!;
    cancel.click();
    await page.settle();
    expect(page.element.querySelector('form')).toBeNull();
  });

  it('Unlink asks first, then unlinks and shows the form again', async () => {
    const page = await render(LINKED);
    await page.click('.unlink');
    expect(dialogs.map((d) => d.title)).toEqual(['Unlink the CRM account?']);
    backend
      .expectOne({ method: 'DELETE', url: '/api/crm/link' })
      .flush(null, { status: 204, statusText: 'No Content' });
    await vi.waitFor(() =>
      backend.expectOne({ method: 'GET', url: '/api/crm/link' }).flush(UNLINKED),
    );
    await vi.waitFor(() => expect(snacks).toEqual(['CRM account unlinked']));
    await page.settle();
    expect(page.input('username')).not.toBeNull();
  });

  it('Unlink cancelled: nothing sent', async () => {
    const page = await render(LINKED);
    confirmed = false;
    await page.click('.unlink');
    expect(dialogs).toHaveLength(1);
    expect(snacks).toEqual([]);
  });
});
