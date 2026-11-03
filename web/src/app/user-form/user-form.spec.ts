import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Clipboard } from '@angular/cdk/clipboard';

import { errorInterceptor } from '../data/error-interceptor';
import { User } from '../data/user';
import { UserForm } from './user-form';

const friend: User = {
  id: 7,
  username: 'friend',
  email: 'friend@dev.invalid',
  role: 'user',
  blocked: false,
  hasPassword: true,
  createdAt: '2026-10-03T09:00:00Z',
};

describe('UserForm', () => {
  let fixture: ComponentFixture<UserForm>;
  let backend: HttpTestingController;
  let said: unknown[];
  let copied: string[];

  const element = () => fixture.nativeElement as HTMLElement;
  const input = (field: string) => element().querySelector<HTMLInputElement>(`input[formControlName="${field}"]`);
  const button = (text: string) =>
    Array.from(element().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim().endsWith(text))!;

  async function render(user: User | null = null): Promise<void> {
    fixture = TestBed.createComponent(UserForm);
    if (user) fixture.componentRef.setInput('user', user);
    said = [];
    fixture.componentInstance.saved.subscribe((saved) => said.push(saved));
    fixture.componentInstance.cancelled.subscribe(() => said.push('cancelled'));
    await fixture.whenStable();
  }

  async function type(field: string, value: string): Promise<void> {
    input(field)!.value = value;
    input(field)!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  async function save(): Promise<void> {
    element().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
  }

  const errorUnder = (field: string) => input(field)!.closest('mat-form-field')!.querySelector('mat-error')?.textContent?.trim();

  beforeEach(async () => {
    copied = [];
    await TestBed.configureTestingModule({
      imports: [UserForm],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: Clipboard, useValue: { copy: (text: string) => (copied.push(text), true) } },
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  describe('a new user', () => {
    beforeEach(() => render());

    it('asks for username, email, role and a starting password', async () => {
      expect(element().querySelector('h2')?.textContent?.trim()).toBe('New user');
      expect(input('username')).not.toBeNull();
      expect(input('password')!.type).toBe('password');
      expect(input('password')!.getAttribute('autocomplete')).toBe('new-password');
      expect(element().querySelector('mat-slide-toggle')).toBeNull(); // nobody new is blocked
      expect(button('Create')).toBeTruthy();
    });

    it('sends what was typed and says saved with the 201', async () => {
      await type('username', 'friend');
      await type('email', 'friend@dev.invalid');
      await type('password', 'Friend-pass-0001');
      element().querySelectorAll<HTMLButtonElement>('mat-button-toggle button')[1]!.click(); // Administrator
      await fixture.whenStable();
      await save();

      const req = backend.expectOne({ method: 'POST', url: '/api/admin/users' });
      expect(req.request.body).toEqual({ username: 'friend', email: 'friend@dev.invalid', password: 'Friend-pass-0001', role: 'admin' });
      req.flush({ ...friend, role: 'admin' }, { status: 201, statusText: 'Created' });
      await fixture.whenStable();
      expect(said).toEqual([{ ...friend, role: 'admin' }]);
    });

    it('sends nothing while a field is empty', async () => {
      await save();
      expect(errorUnder('username')).toBe('Required');
      expect(errorUnder('email')).toBe('Required');
      expect(errorUnder('password')).toBe('Required');
    });

    it("Generate puts the server's password in the field, readable, and Copy copies it", async () => {
      button('Generate').click();
      backend.expectOne({ method: 'GET', url: '/api/admin/generated-password' }).flush({ password: 'Gen-erated-pass-42' });
      await fixture.whenStable();

      expect(input('password')!.value).toBe('Gen-erated-pass-42');
      expect(input('password')!.type).toBe('text');
      expect(element().querySelector('.once')?.textContent?.trim()).toBe('Pass it on now: once saved, nobody can read it again.');

      button('Copy').click();
      await fixture.whenStable();
      expect(copied).toEqual(['Gen-erated-pass-42']);
      expect(button('Copied')).toBeTruthy();
    });

    it("the API's reasons go under their fields", async () => {
      await type('username', 'login');
      await type('email', 'taken@dev.invalid');
      await type('password', 'weak');
      await save();
      backend.expectOne('/api/admin/users').flush(
        {
          type: 'urn:vtiger-reader:problem:validation',
          title: 'Bad Request',
          status: 400,
          detail: '"login" is a reserved word',
          errors: [{ field: 'username', message: '"login" is a reserved word' }],
        },
        { status: 400, statusText: 'Bad Request' },
      );
      await fixture.whenStable();

      expect(errorUnder('username')).toBe('"login" is a reserved word');
      expect(element().querySelector('.form-error')).toBeNull();
      expect(said).toEqual([]);
    });
  });

  describe('a user that exists', () => {
    beforeEach(() => render(friend));

    it('is filled in; the username never changes, so it is only in the title', () => {
      expect(element().querySelector('h2')?.textContent?.trim()).toBe('Edit friend');
      expect(input('username')).toBeNull();
      expect(input('email')!.value).toBe('friend@dev.invalid');
      expect(input('password')!.value).toBe('');
      expect(element().querySelector('mat-label')?.textContent).not.toContain('Username');
      expect(element().querySelector('mat-slide-toggle')?.textContent?.trim()).toBe('Blocked');
    });

    it('sends only what changed: a typed password is a reset, an empty one keeps it', async () => {
      await type('email', 'friend@new.invalid');
      element().querySelector<HTMLButtonElement>('mat-slide-toggle button')!.click();
      await fixture.whenStable();
      await save();

      const req = backend.expectOne({ method: 'PATCH', url: '/api/admin/users/7' });
      expect(req.request.body).toEqual({ email: 'friend@new.invalid', blocked: true });
      req.flush({ ...friend, email: 'friend@new.invalid', blocked: true });
      await fixture.whenStable();
      expect(said).toEqual([{ ...friend, email: 'friend@new.invalid', blocked: true }]);
    });

    it('a new password alone', async () => {
      await type('password', 'Friend-pass-0002');
      await save();
      const req = backend.expectOne({ method: 'PATCH', url: '/api/admin/users/7' });
      expect(req.request.body).toEqual({ password: 'Friend-pass-0002' });
      req.flush(friend);
    });

    it('nothing changed: saved at once, no request', async () => {
      await save();
      expect(said).toEqual([friend]);
    });

    it('a password used before comes back under the password', async () => {
      await type('password', 'Friend-pass-0001');
      await save();
      backend.expectOne('/api/admin/users/7').flush(
        {
          type: 'urn:vtiger-reader:problem:password-used-before',
          title: 'Conflict',
          status: 409,
          detail: 'This password was already used: choose one never used before',
          errors: [{ field: 'password', message: 'This password was already used: choose one never used before' }],
        },
        { status: 409, statusText: 'Conflict' },
      );
      await fixture.whenStable();
      expect(errorUnder('password')).toBe('This password was already used: choose one never used before');
    });
  });
});
