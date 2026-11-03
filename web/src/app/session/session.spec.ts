import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { AuthApi, type SessionUser } from '../data/auth-api';
import { Session } from './session';

const lenzi: SessionUser = { id: 1, username: 'lenzi', role: 'admin', impersonatedBy: null };

describe('Session', () => {
  let answer: () => Observable<SessionUser | null>;
  let getSession: ReturnType<typeof vi.fn>;
  let signIn: ReturnType<typeof vi.fn>;
  let signOut: ReturnType<typeof vi.fn>;
  let session: Session;

  beforeEach(() => {
    answer = () => of(lenzi);
    getSession = vi.fn(() => answer());
    signIn = vi.fn(() => of(undefined));
    signOut = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({ providers: [{ provide: AuthApi, useValue: { getSession, signIn, signOut } }] });
    session = TestBed.inject(Session);
  });

  it('asks the server once, however many pages ask', async () => {
    expect(await Promise.all([session.load(), session.load()])).toEqual([lenzi, lenzi]);
    await session.load();

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(session.user()).toEqual(lenzi);
  });

  it("builds the addresses of the user's pages under their username", async () => {
    // nobody (component tests): the pages at the root
    expect(session.path()).toBe('/');
    expect(session.path('/metrics')).toBe('/metrics');

    await session.load();
    expect(session.path()).toBe('/lenzi');
    expect(session.path('/statistics/edit')).toBe('/lenzi/statistics/edit');
  });

  it('the admin view is for an administrator acting as itself', async () => {
    expect(session.canAdminister()).toBe(false); // nobody yet
    await session.load();
    expect(session.canAdminister()).toBe(true);

    answer = () => of({ ...lenzi, id: 3, username: 'chief', impersonatedBy: 1 });
    await session.reload();
    expect(session.canAdminister()).toBe(false);

    answer = () => of({ id: 2, username: 'friend', role: 'user', impersonatedBy: null });
    await session.reload();
    expect(session.canAdminister()).toBe(false);
  });

  it('reload asks the server again (an impersonation started or ended)', async () => {
    await session.load();
    answer = () => of({ id: 2, username: 'friend', role: 'user', impersonatedBy: 1 });
    expect(await session.reload()).toEqual({ id: 2, username: 'friend', role: 'user', impersonatedBy: 1 });
    expect(session.path()).toBe('/friend');
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('remembers nobody, and asks again after a network failure', async () => {
    answer = () => of(null);
    expect(await session.load()).toBeNull();
    expect(session.user()).toBeNull();

    answer = () => throwError(() => ({ status: null }));
    session.forget();
    expect(await session.load()).toBeNull();
    answer = () => of(lenzi);
    expect(await session.load()).toEqual(lenzi);
    expect(getSession).toHaveBeenCalledTimes(3);
  });

  it('signs in, then asks again who it is', async () => {
    answer = () => of(null);
    await session.load();

    answer = () => of(lenzi);
    expect(await session.signIn('lenzi', 'Lenzi-pass-0001')).toEqual(lenzi);
    expect(signIn).toHaveBeenCalledWith('lenzi', 'Lenzi-pass-0001');
    expect(session.user()).toEqual(lenzi);
  });

  it('a refused sign-in rejects with the error and keeps nobody', async () => {
    answer = () => of(null);
    await session.load();
    signIn.mockReturnValue(throwError(() => ({ status: 401 })));

    await expect(session.signIn('lenzi', 'wrong')).rejects.toEqual({ status: 401 });
    expect(session.user()).toBeNull();
  });

  it('signs out and forgets the user', async () => {
    await session.load();
    await session.signOut();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(session.user()).toBeNull();
  });

  it('a sign-out the server did not take keeps the user: the session is still alive', async () => {
    await session.load();
    signOut.mockReturnValue(throwError(() => ({ status: null })));

    await expect(session.signOut()).rejects.toEqual({ status: null });
    expect(session.user()).toEqual(lenzi);
  });
});
