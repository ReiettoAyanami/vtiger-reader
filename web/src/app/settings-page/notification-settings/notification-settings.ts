import { Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../data/api-error';
import { ListsApi } from '../../data/lists-api';
import { NotificationsApi } from '../../data/notifications-api';
import { DesktopBridge } from '../../desktop/desktop-bridge';

/** What a failed request says, short. */
function reason(error: unknown): string {
  const e = ((error as { cause?: unknown })?.cause ?? error) as Partial<ApiError> & {
    message?: string;
  };
  return e.detail || e.title || e.message || 'unknown error';
}

/**
 * The profile's notifications (plan 5.2, 7.2): on or off, which of the lists a new ticket notifies
 * from, and a test on this PC. They are the system's own notifications, shown while the app runs
 * (also from the tray); the bell and the open app follow the same choice.
 */
@Component({
  selector: 'app-notification-settings',
  imports: [MatButtonModule, MatCheckboxModule, MatSlideToggleModule],
  templateUrl: './notification-settings.html',
  styleUrl: './notification-settings.css',
})
export class NotificationSettings {
  private readonly api = inject(NotificationsApi);
  private readonly listsApi = inject(ListsApi);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly desktop = inject(DesktopBridge);

  protected readonly settings = rxResource({ stream: () => this.api.settings() });
  protected readonly lists = rxResource({ stream: () => this.listsApi.lists() });

  /** The choice as edited, before Save. */
  protected readonly enabled = signal(false);
  protected readonly picked = signal<ReadonlySet<number>>(new Set());

  protected readonly saving = signal(false);
  protected readonly testing = signal(false);
  /** The app starts with Windows, in the tray (desktop app only); null until read. */
  protected readonly atLogin = signal<boolean | null>(null);

  protected readonly failure = computed(() => {
    const error = this.settings.error() ?? this.lists.error();
    return error ? `Could not load the notifications (${reason(error)})` : null;
  });

  protected readonly dirty = computed(() => {
    if (!this.settings.hasValue()) return false;
    const saved = this.settings.value();
    const picked = this.picked();
    return (
      saved.enabled !== this.enabled() ||
      saved.lists.length !== picked.size ||
      saved.lists.some((id) => !picked.has(id))
    );
  });

  constructor() {
    // The form shows what the API has: when it arrives, and after a save.
    effect(() => {
      if (!this.settings.hasValue()) return;
      const { enabled, lists } = this.settings.value();
      this.enabled.set(enabled);
      this.picked.set(new Set(lists));
    });
    if (this.desktop.available) {
      void this.desktop.startAtLogin().then(
        (on) => this.atLogin.set(on),
        () => this.atLogin.set(false),
      );
    }
  }

  protected async setAtLogin(on: boolean): Promise<void> {
    try {
      this.atLogin.set(await this.desktop.setStartAtLogin(on));
    } catch (error) {
      this.snackBar.open(`Could not change it: ${reason(error)}`, 'OK');
    }
  }

  protected toggle(id: number, checked: boolean): void {
    const next = new Set(this.picked());
    if (checked) next.add(id);
    else next.delete(id);
    this.picked.set(next);
  }

  protected save(): void {
    if (this.saving()) return;
    const order = (this.lists.value() ?? []).map((l) => l.id);
    const ids = order.filter((id) => this.picked().has(id));
    this.saving.set(true);
    this.api.updateSettings(this.enabled(), ids).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.settings.set(saved);
        this.snackBar.open('Notifications saved', undefined, { duration: 3000 });
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.snackBar.open(`Could not save: ${reason(error)}`, 'OK');
      },
    });
  }

  protected async test(): Promise<void> {
    if (this.testing()) return;
    this.testing.set(true);
    try {
      const shown = await firstValueFrom(this.api.test());
      this.snackBar.open(
        shown
          ? 'Sent: it should be on the screen now'
          : 'Not shown: this is not the desktop app, or Windows has notifications off for it',
        shown ? undefined : 'OK',
        shown ? { duration: 4000 } : {},
      );
    } catch (error) {
      this.snackBar.open(`Could not send: ${reason(error)}`, 'OK');
    } finally {
      this.testing.set(false);
    }
  }
}
