import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VersionLabel } from './version-label';

describe('VersionLabel', () => {
  let fixture: ComponentFixture<VersionLabel>;
  let backend: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VersionLabel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(VersionLabel);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  const text = () => (fixture.nativeElement as HTMLElement).textContent?.trim() ?? '';

  it('shows the version the API reports', async () => {
    fixture.detectChanges();
    backend.expectOne('/api/version').flush({ version: 'dev26.0.0' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toBe('dev26.0.0');
  });

  it('shows nothing while waiting, nor when the API fails', async () => {
    fixture.detectChanges();
    expect(text()).toBe('');
    backend.expectOne('/api/version').flush('down', { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toBe('');
  });
});
