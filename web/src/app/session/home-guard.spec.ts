import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { AuthApi, type SessionUser } from '../data/auth-api';
import { homeGuard } from './home-guard';

@Component({ template: '' })
class Blank {}

describe('homeGuard', () => {
  async function visitRootAs(user: SessionUser | null): Promise<string> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', pathMatch: 'full', canActivate: [homeGuard], children: [] },
          { path: 'login', component: Blank },
          { path: 'lenzi', component: Blank },
        ]),
        { provide: AuthApi, useValue: { getSession: () => of(user) } },
      ],
    });
    await RouterTestingHarness.create('/');
    return TestBed.inject(Router).url;
  }

  it("the bare address opens the signed-in user's own pages", async () => {
    expect(await visitRootAs({ id: 1, username: 'lenzi', role: 'user', impersonatedBy: null })).toBe('/lenzi');
  });

  it('signed out, the sign-in page', async () => {
    expect(await visitRootAs(null)).toBe('/login');
  });
});
