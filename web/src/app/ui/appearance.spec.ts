import { TestBed } from '@angular/core/testing';

import { Appearance } from './appearance';

describe('Appearance', () => {
  const reduced = () => document.documentElement.classList.contains('reduce-transparency');

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('reduce-transparency');
  });

  afterEach(() => document.documentElement.classList.remove('reduce-transparency'));

  it('starts with the windows see-through: nothing reduced', () => {
    const appearance = TestBed.inject(Appearance);
    TestBed.tick();

    expect(appearance.reduceTransparency()).toBe(false);
    expect(reduced()).toBe(false);
  });

  it('reducing the transparency marks the page at once, and this browser remembers it', () => {
    TestBed.inject(Appearance).setReduceTransparency(true);
    TestBed.tick();
    expect(reduced()).toBe(true);

    TestBed.resetTestingModule();
    document.documentElement.classList.remove('reduce-transparency');
    const again = TestBed.inject(Appearance);
    TestBed.tick();
    expect(again.reduceTransparency()).toBe(true);
    expect(reduced()).toBe(true);

    again.setReduceTransparency(false);
    TestBed.tick();
    expect(reduced()).toBe(false);
  });
});
