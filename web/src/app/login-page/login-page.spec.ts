import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, Subject, of, throwError } from 'rxjs';

import type { ApiError } from '../data/api-error';
import { AuthApi, type SessionUser } from '../data/auth-api';
import { LoginPage } from './login-page';

@Component({ template: '' })
class Blank {}

const lenzi: SessionUser = { id: 1, username: 'lenzi', role: 'admin', impersonatedBy: null };

function refused(status: number | null, code: string | null = null): ApiError {
  return { status, code, title: '', detail: 'refused', fieldErrors: [] };
}

describe('LoginPage', () => {
  let session: SessionUser | null;
  let signIn: ReturnType<typeof vi.fn<(username: string, password: string) => Observable<void>>>;

  beforeEach(() => {
    session = null;
    signIn = vi.fn((username: string, password: string) => {
      if (username !== 'lenzi' || password !== 'Lenzi-pass-0001') return throwError(() => refused(401));
      session = lenzi;
      return of(undefined);
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: LoginPage },
          { path: 'lenzi', component: Blank },
          { path: 'lenzi/metrics', component: Blank },
          { path: 'other/metrics', component: Blank },
          { path: 'lenzi/admin', component: Blank },
          { path: 'admin', component: Blank },
        ]),
        { provide: AuthApi, useValue: { getSession: () => of(session), signIn } },
      ],
    });
  });

  async function open(url = '/login') {
    const harness = await RouterTestingHarness.create(url);
    const element = harness.routeNativeElement!;
    const input = (name: string) => element.querySelector<HTMLInputElement>(`input[formcontrolname="${name}"]`)!;
    return {
      element,
      input,
      type: (name: string, value: string) => {
        input(name).value = value;
        input(name).dispatchEvent(new Event('input'));
      },
      submit: async () => {
        element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
        await harness.fixture.whenStable();
        harness.detectChanges();
      },
      error: () => element.querySelector('.form-error')?.textContent?.trim(),
      fieldErrors: () => Array.from(element.querySelectorAll('mat-error')).map((e) => e.textContent?.trim()),
      settle: async () => {
        await harness.fixture.whenStable();
        harness.detectChanges();
      },
    };
  }

  it('asks for the username and the password, and says who resets a forgotten password', async () => {
    const page = await open();

    expect(page.element.querySelector('h1')?.textContent?.trim()).toBe('vtiger reader');
    expect(page.input('username').getAttribute('autocomplete')).toBe('username');
    expect(page.input('password').type).toBe('password');
    expect(page.input('password').getAttribute('autocomplete')).toBe('current-password');
    expect(page.element.querySelector('.hint')?.textContent?.trim()).toBe('Forgot your password? Ask your administrator.');
    // no sign-up, no reset by email
    expect(page.element.querySelectorAll('a')).toHaveLength(0);
  });

  it('sends nothing while a field is empty', async () => {
    const page = await open();
    await page.submit();

    expect(signIn).not.toHaveBeenCalled();
    expect(page.fieldErrors()).toEqual(['Enter your username', 'Enter your password']);
  });

  it('a wrong username or password: says so without saying which, empties the password, keeps the username', async () => {
    const page = await open();
    page.type('username', 'lenzi');
    page.type('password', 'not-the-password');
    await page.submit();

    expect(page.error()).toBe('Wrong username or password.');
    expect(page.input('username').value).toBe('lenzi');
    expect(page.input('password').value).toBe('');
    // no field in error next to the message, and the cursor back in the password
    expect(page.fieldErrors()).toEqual([]);
    expect(document.activeElement).toBe(page.input('password'));
    expect(TestBed.inject(Router).url).toBe('/login');
  });

  it.each([
    [refused(403, 'banned-user'), 'This account is blocked: ask your administrator.'],
    [refused(403, 'origin'), 'Signing in works only from the address of the app: this one is not it.'],
    [refused(422, 'invalid-username'), 'That is not a username: only letters, digits, - and _ (not the email address).'],
    [refused(429, 'too-many-requests'), 'Too many attempts: wait a few seconds, then try again.'],
    [refused(null), 'The server cannot be reached. Check the connection and try again.'],
  ])('a refusal says what to do (%o)', async (error, message) => {
    signIn.mockReturnValue(throwError(() => error));
    const page = await open();
    page.type('username', 'lenzi');
    page.type('password', 'Lenzi-pass-0001');
    await page.submit();

    expect(page.error()).toBe(message);
  });

  it('a sign-in that takes a while says it may be waiting after wrong passwords, until it is answered', async () => {
    const answer = new Subject<void>();
    signIn.mockReturnValue(answer);
    const page = await open();
    page.type('username', 'lenzi');
    page.type('password', 'not-the-password');
    page.element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    await page.settle();
    expect(page.element.querySelector('.slow')).toBeNull(); // not at once
    await vi.waitFor(
      async () => {
        await page.settle();
        expect(page.element.querySelector('.slow')?.textContent?.trim()).toBe(
          'Still checking: after several wrong passwords, each try waits a little longer.',
        );
      },
      { timeout: 3000 },
    );

    answer.error(refused(401));
    await vi.waitFor(async () => {
      await page.settle();
      expect(page.error()).toBe('Wrong username or password.');
    });
    expect(page.element.querySelector('.slow')).toBeNull();
  });

  it('signed in, goes to the start page of the user (the username as typed, spaces trimmed)', async () => {
    const page = await open();
    page.type('username', ' lenzi ');
    page.type('password', 'Lenzi-pass-0001');
    await page.submit();

    expect(signIn).toHaveBeenCalledWith('lenzi', 'Lenzi-pass-0001');
    expect(TestBed.inject(Router).url).toBe('/lenzi');
  });

  it('goes back to the page it came from, when it is one of the user’s own', async () => {
    const page = await open('/login?next=%2Flenzi%2Fmetrics%3Fper%3Dweek');
    page.type('username', 'lenzi');
    page.type('password', 'Lenzi-pass-0001');
    await page.submit();

    expect(TestBed.inject(Router).url).toBe('/lenzi/metrics?per=week');
  });

  it('an administrator goes back to the admin view too: one of its own pages (/<username>/admin)', async () => {
    const page = await open('/login?next=%2Flenzi%2Fadmin');
    page.type('username', 'lenzi');
    page.type('password', 'Lenzi-pass-0001');
    await page.submit();

    expect(TestBed.inject(Router).url).toBe('/lenzi/admin');
  });

  // /admin: since 2026-10-03 the start page of a user called admin, no more the admin view
  it.each(['/other/metrics', '/lenzix', '/admin', 'https://example.com/lenzi', '//example.com/lenzi'])(
    'never goes to a page that is not the user’s own (next=%s)',
    async (next) => {
      const page = await open(`/login?next=${encodeURIComponent(next)}`);
      page.type('username', 'lenzi');
      page.type('password', 'Lenzi-pass-0001');
      await page.submit();

      expect(TestBed.inject(Router).url).toBe('/lenzi');
    },
  );
});
