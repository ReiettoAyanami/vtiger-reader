import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { AuthApi, type SessionUser } from '../../data/auth-api';
import { Session } from '../../session/session';
import { ViewingAsBar } from './viewing-as-bar';

@Component({ template: '' })
class Blank {}

const asFriend: SessionUser = { id: 7, username: 'friend', role: 'user', impersonatedBy: 1 };
const lenzi: SessionUser = { id: 1, username: 'lenzi', role: 'admin', impersonatedBy: null };

describe('ViewingAsBar', () => {
  let session: SessionUser | null;
  let stop: () => Observable<void>;

  async function render() {
    TestBed.configureTestingModule({
      imports: [ViewingAsBar],
      providers: [
        provideRouter([
          { path: 'lenzi/admin', component: Blank },
          { path: 'login', component: Blank },
          { path: 'friend', component: Blank },
        ]),
        { provide: AuthApi, useValue: { getSession: () => of(session), stopImpersonating: () => stop() } },
      ],
    });
    await TestBed.inject(Session).load();
    await TestBed.inject(Router).navigateByUrl('/friend');
    const fixture = TestBed.createComponent(ViewingAsBar);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    session = asFriend;
  });

  it('says whose app the administrator is in', async () => {
    const element = await render();
    expect(element.querySelector('.text')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Viewing as friend');
    expect(element.querySelector('button')?.textContent?.trim()).toBe('Exit');
  });

  it("Exit gives the administrator its own session back, and the admin view", async () => {
    stop = () => {
      session = lenzi;
      return of(undefined);
    };
    const element = await render();
    element.querySelector<HTMLButtonElement>('button')!.click();

    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/lenzi/admin'));
    expect(TestBed.inject(Session).user()).toEqual(lenzi);
  });

  it('an impersonation past its hour cannot go back: the sign-in page', async () => {
    stop = () => throwError(() => ({ status: 401 }));
    const element = await render();
    element.querySelector<HTMLButtonElement>('button')!.click();

    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/login'));
    expect(TestBed.inject(Session).user()).toBeNull();
  });
});
