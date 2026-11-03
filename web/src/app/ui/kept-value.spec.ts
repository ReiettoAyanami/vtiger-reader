import { signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TestBed } from '@angular/core/testing';
import { ReplaySubject } from 'rxjs';

import { keptValue } from './kept-value';

/** The resource subscribes and answers on its own schedule: a task, then the signals again. */
async function settle(): Promise<void> {
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

/** A resource asked by a scale and a page, its answers sent by hand. */
function setup() {
  const scale = signal('day');
  const page = signal(1);
  const answers = new Map<string, ReplaySubject<string>>();
  const answer = (key: string) => {
    if (!answers.has(key)) answers.set(key, new ReplaySubject<string>(1));
    return answers.get(key)!;
  };
  return TestBed.runInInjectionContext(() => {
    const resource = rxResource({
      params: () => ({ scale: scale(), page: page() }),
      stream: ({ params }) => answer(`${params.page}/${params.scale}`),
    });
    const kept = keptValue(resource, () => page());
    return { scale, page, answer, resource, kept };
  });
}

describe('keptValue', () => {
  it('is null until the first answer, then the answer', async () => {
    const { answer, kept } = setup();
    await settle();
    expect(kept()).toBeNull();
    answer('1/day').next('1 by day');
    await settle();
    expect(kept()).toBe('1 by day');
  });

  it('keeps the last answer while another scale loads: the resource alone has none', async () => {
    const { scale, answer, resource, kept } = setup();
    await settle();
    answer('1/day').next('1 by day');
    await settle();
    expect(kept()).toBe('1 by day'); // shown, as a template reads it
    scale.set('week');
    await settle();
    expect(resource.hasValue()).toBe(false);
    expect(kept()).toBe('1 by day');
    answer('1/week').next('1 by week');
    await settle();
    expect(kept()).toBe('1 by week');
  });

  it('drops it when what is shown changes (the key)', async () => {
    const { page, answer, kept } = setup();
    await settle();
    answer('1/day').next('1 by day');
    await settle();
    expect(kept()).toBe('1 by day'); // shown, as a template reads it
    page.set(2);
    await settle();
    expect(kept()).toBeNull();
  });

  it('drops it on a failure', async () => {
    const { scale, answer, kept } = setup();
    await settle();
    answer('1/day').next('1 by day');
    await settle();
    expect(kept()).toBe('1 by day'); // shown, as a template reads it
    scale.set('week');
    await settle();
    answer('1/week').error(new Error('down'));
    await settle();
    expect(kept()).toBeNull();
  });
});
