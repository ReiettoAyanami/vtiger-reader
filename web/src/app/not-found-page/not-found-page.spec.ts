import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NotFoundPage } from './not-found-page';

describe('NotFoundPage', () => {
  it('says there is nothing here, and leads to the tickets', async () => {
    TestBed.configureTestingModule({ imports: [NotFoundPage], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(NotFoundPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Page not found');
    const link = element.querySelector('a')!;
    expect(link.textContent?.trim()).toBe('Go to the tickets');
    expect(link.getAttribute('href')).toBe('/');
  });
});
