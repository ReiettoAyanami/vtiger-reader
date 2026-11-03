import { statusColor } from './status-color';

describe('statusColor', () => {
  it('as substance-tracker colours its substance 1, 2, 3: from the place, violet, three lightnesses', () => {
    // substance-tracker's identityColor(1..3, 'substance'), the same algorithm.
    expect(statusColor(0)).toBe('oklch(0.74 0.179 309.4)');
    expect(statusColor(1)).toBe('oklch(0.6 0.22 278.9)');
    expect(statusColor(2)).toBe('oklch(0.88 0.107 328.3)');
    expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map(statusColor)).size).toBe(8);
  });

  it('a status the CRM does not list: no colour of its own', () => {
    expect(statusColor(-1)).toBe('var(--mat-sys-surface-container-highest)');
  });
});
