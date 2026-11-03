import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { AuthApi, type SessionUser } from '../../data/auth-api';
import { errorInterceptor } from '../../data/error-interceptor';
import { Session } from '../../session/session';
import { AccountSettings } from './account-settings';

const lenzi: SessionUser = { id: 1, username: 'lenzi', role: 'admin', impersonatedBy: null };

describe('AccountSettings', () => {
  let backend: HttpTestingController;
  let snacks: string[];
  let revoked: number;
  let revoke: () => ReturnType<AuthApi['revokeOtherSessions']>;

  async function render(user: SessionUser = lenzi) {
    snacks = [];
    revoked = 0;
    revoke = () => (revoked++, of(undefined));
    TestBed.configureTestingModule({
      imports: [AccountSettings],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthApi, useValue: { getSession: () => of(user), revokeOtherSessions: () => revoke() } },
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    await TestBed.inject(Session).load();
    const fixture = TestBed.createComponent(AccountSettings);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const input = (field: string) => element.querySelector<HTMLInputElement>(`input[formControlName="${field}"]`)!;
    return {
      element,
      input,
      settle: () => fixture.whenStable(),
      type: async (field: string, value: string) => {
        input(field).value = value;
        input(field).dispatchEvent(new Event('input'));
        await fixture.whenStable();
      },
      submit: async () => {
        element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
        await fixture.whenStable();
      },
      errorUnder: (field: string) => input(field).closest('mat-form-field')!.querySelector('mat-error')?.textContent?.trim(),
    };
  }

  afterEach(() => backend.verify());

  it('asks for the current password and the new one, for the password manager too', async () => {
    const page = await render();
    expect(page.input('currentPassword').getAttribute('autocomplete')).toBe('current-password');
    expect(page.input('newPassword').getAttribute('autocomplete')).toBe('new-password');
    expect(page.element.querySelector<HTMLInputElement>('input[autocomplete="username"]')?.value).toBe('lenzi');
    expect(page.element.querySelector('.sign-out-elsewhere')?.textContent?.trim()).toBe('Sign out of the other devices');
  });

  it('changes it: the fields empty again, and it says the other devices are signed out', async () => {
    const page = await render();
    await page.type('currentPassword', 'Lenzi-pass-0001');
    await page.type('newPassword', 'Lenzi-pass-0002');
    await page.submit();

    const req = backend.expectOne({ method: 'POST', url: '/api/account/password' });
    expect(req.request.body).toEqual({ currentPassword: 'Lenzi-pass-0001', newPassword: 'Lenzi-pass-0002' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await vi.waitFor(() => expect(snacks).toEqual(['Password changed. Your other devices are signed out.']));
    await page.settle();

    expect(page.input('currentPassword').value).toBe('');
    expect(page.input('newPassword').value).toBe('');
    expect(page.element.querySelectorAll('mat-error')).toHaveLength(0);
  });

  it('sends nothing while a field is empty', async () => {
    const page = await render();
    await page.submit();
    expect(page.errorUnder('currentPassword')).toBe('Required');
    expect(page.errorUnder('newPassword')).toBe('Required');
  });

  it("the API's reasons go under their field: a wrong current password, a password used before", async () => {
    const page = await render();
    await page.type('currentPassword', 'wrong');
    await page.type('newPassword', 'Lenzi-pass-0002');
    await page.submit();
    backend.expectOne('/api/account/password').flush(
      {
        type: 'urn:vtiger-reader:problem:wrong-password',
        title: 'Bad Request',
        status: 400,
        detail: 'This is not your current password',
        errors: [{ field: 'currentPassword', message: 'This is not your current password' }],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await vi.waitFor(() => expect(page.errorUnder('currentPassword')).toBe('This is not your current password'));
    expect(snacks).toEqual([]);
  });

  it('signs out of the other devices, and says so', async () => {
    const page = await render();
    page.element.querySelector<HTMLButtonElement>('.sign-out-elsewhere')!.click();
    await vi.waitFor(() => expect(snacks).toEqual(['Signed out of the other devices.']));
    expect(revoked).toBe(1);
  });

  it("while an administrator views the app as the user: neither, the account is the user's own", async () => {
    const page = await render({ id: 7, username: 'friend', role: 'user', impersonatedBy: 1 });
    expect(page.element.querySelector('form')).toBeNull();
    expect(page.element.querySelector('.sign-out-elsewhere')).toBeNull();
    expect(page.element.querySelector('.note')?.textContent?.trim()).toBe(
      'You are viewing the app as friend: their password and their devices are theirs.',
    );
  });
});
