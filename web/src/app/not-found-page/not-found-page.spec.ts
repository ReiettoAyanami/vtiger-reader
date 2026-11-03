import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AuthApi, type SessionUser } from '../data/auth-api';
import { Session } from '../session/session';
import { NotFoundPage } from './not-found-page';

describe('NotFoundPage', () => {
  async function open(user: SessionUser | null) {
    TestBed.configureTestingModule({
      imports: [NotFoundPage],
      providers: [provideRouter([]), { provide: AuthApi, useValue: { getSession: () => of(user) } }],
    });
    await TestBed.inject(Session).load();
    const fixture = TestBed.createComponent(NotFoundPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('says there is nothing here, and leads to the start page of the signed-in user', async () => {
    const element = await open({ id: 1, username: 'lenzi', role: 'user', impersonatedBy: null });

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Page not found');
    const link = element.querySelector('a')!;
    expect(link.textContent?.trim()).toBe('Go to your tickets');
    expect(link.getAttribute('href')).toBe('/lenzi');
  });

  it('signed out, leads to the sign-in page', async () => {
    const element = await open(null);

    const link = element.querySelector('a')!;
    expect(link.textContent?.trim()).toBe('Sign in');
    expect(link.getAttribute('href')).toBe('/login');
  });
});
