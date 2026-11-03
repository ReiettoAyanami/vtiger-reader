import { Injectable, Pipe, PipeTransform, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { SettingsApi } from '../data/settings-api';
import { LOCALE } from '../locale';

/**
 * The time zone the CRM's times are shown in (the user's setting), read once; Europe/Rome until it
 * comes, or when it cannot be read.
 */
@Injectable({ providedIn: 'root' })
export class UserTimeZone {
  private readonly api = inject(SettingsApi);
  private readonly current = signal('Europe/Rome');
  private loading: Promise<void> | null = null;

  readonly zone = this.current.asReadonly();

  load(): Promise<void> {
    this.loading ??= firstValueFrom(this.api.getSettings())
      .then((settings) => this.current.set(settings.timezone))
      .catch(() => undefined);
    return this.loading;
  }
}

/**
 * An instant as a reader wants it, in a time zone: "14:05" today, "3 Nov, 14:05" this year,
 * "3 Nov 2025, 14:05" before. `now` for the tests.
 */
export function formatWhen(
  iso: string | null | undefined,
  timeZone: string,
  now: Date = new Date(),
): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  const time = new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  if (day(date) === day(now)) return time;
  const sameYear = day(date).slice(0, 4) === day(now).slice(0, 4);
  const dateText = new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
  return `${dateText}, ${time}`;
}

/** `{{ ticket.createdAt | when }}`: an instant in the user's time zone. */
@Pipe({ name: 'when', pure: false })
export class WhenPipe implements PipeTransform {
  private readonly zone = inject(UserTimeZone);

  constructor() {
    void this.zone.load();
  }

  transform(iso: string | null | undefined): string {
    return formatWhen(iso, this.zone.zone());
  }
}
