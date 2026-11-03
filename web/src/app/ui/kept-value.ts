// A resource's value that stays on screen while the next one loads. A plain module (no schematic
// makes one).
import { Resource, Signal, linkedSignal } from '@angular/core';

/**
 * The resource's value, kept while new params load: a resource has none from the moment its params
 * change until the answer comes, so a panel that shows "…" meanwhile shrinks and rebuilds what it
 * shows (lenzi, 2026-10-01: a toggle made the consumption details shrink and replay their opening).
 * With this a toggle redraws in place. Null before the first answer, after a failure, and when
 * `key` changes: another thing is shown (another entity, another table), not the same thing again.
 */
export function keptValue<T>(resource: Resource<T | undefined>, key: () => unknown = () => null): Signal<T | null> {
  return linkedSignal<{ value: T | undefined; failed: boolean; key: unknown }, T | null>({
    source: () => ({
      value: resource.hasValue() ? resource.value() : undefined,
      failed: resource.error() !== undefined,
      key: key(),
    }),
    computation: (now, before) => {
      if (now.value !== undefined) return now.value;
      if (now.failed || !before || before.source.key !== now.key) return null;
      return before.value;
    },
  });
}
