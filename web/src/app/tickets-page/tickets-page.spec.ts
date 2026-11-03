import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TicketsPage } from './tickets-page';

describe('TicketsPage', () => {
  it('points to the settings until the CRM is linked', async () => {
    await TestBed.configureTestingModule({ imports: [TicketsPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(TicketsPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Tickets');
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/settings');
  });
});
