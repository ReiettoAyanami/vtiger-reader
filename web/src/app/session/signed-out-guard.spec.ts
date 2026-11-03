import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { AuthApi, type SessionUser } from '../data/auth-api';
import { signedOutGuard } from './signed-out-guard';

@Component({ template: '' })
class Blank {}

describe('signedOutGuard', () => {
  async function visitLoginAs(user: SessionUser | null): Promise<string> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', canActivate: [signedOutGuard], component: Blank },
          { path: 'lenzi', component: Blank },
        ]),
        { provide: AuthApi, useValue: { getSession: () => of(user) } },
      ],
    });
    await RouterTestingHarness.create('/login');
    return TestBed.inject(Router).url;
  }

  it('signed out, the sign-in page opens', async () => {
    expect(await visitLoginAs(null)).toBe('/login');
  });

  it('already signed in, it sends the user to their own pages', async () => {
    expect(await visitLoginAs({ id: 1, username: 'lenzi', role: 'user', impersonatedBy: null })).toBe('/lenzi');
  });
});
