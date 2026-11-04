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
import { PushState, PushSubscriptions } from '../../notifications/push-subscriptions';

/** What a failed request says, short. */
function reason(error: unknown): string {
  const e = ((error as { cause?: unknown })?.cause ?? error) as Partial<ApiError> & {
    message?: string;
  };
  return e.detail || e.title || e.message || 'unknown error';
}

/**
 * The user's notifications (plan 5.2, 5.3): on or off, which of their lists a new ticket notifies
 * them from, and this browser's push (on, off, a test). The bell and the open pages follow the same
 * choice; push only reaches the browsers turned on here.
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
  protected readonly push = inject(PushSubscriptions);

  protected readonly settings = rxResource({ stream: () => this.api.settings() });
  protected readonly lists = rxResource({ stream: () => this.listsApi.lists() });

  /** The choice as edited, before Save. */
  protected readonly enabled = signal(false);
  protected readonly picked = signal<ReadonlySet<number>>(new Set());

  protected readonly saving = signal(false);
  protected readonly pushBusy = signal(false);

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
    void this.push.refresh();
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

  protected async turnPush(on: boolean): Promise<void> {
    if (this.pushBusy()) return;
    this.pushBusy.set(true);
    try {
      const state = on ? await this.push.enable() : await this.push.disable();
      if (on && state === 'blocked') {
        this.snackBar.open('The browser blocked notifications for this site', 'OK');
      }
      this.settings.reload();
    } catch (error) {
      this.snackBar.open(`Could not turn them on: ${reason(error)}`, 'OK');
    } finally {
      this.pushBusy.set(false);
    }
  }

  protected async test(): Promise<void> {
    if (this.pushBusy()) return;
    this.pushBusy.set(true);
    try {
      const sent = await firstValueFrom(this.api.test());
      this.snackBar.open(
        sent ? `Sent to ${sent} ${sent === 1 ? 'device' : 'devices'}` : 'No device got it',
        undefined,
        { duration: 4000 },
      );
      this.settings.reload();
    } catch (error) {
      this.snackBar.open(`Could not send: ${reason(error)}`, 'OK');
    } finally {
      this.pushBusy.set(false);
    }
  }

  protected stateText(state: PushState): string {
    switch (state) {
      case 'on':
        return 'This browser shows them, even with the app closed.';
      case 'off':
        return 'This browser does not show them when the app is closed.';
      case 'blocked':
        return "Notifications are blocked for this site: allow them in the browser's site settings.";
      case 'unsupported':
        return 'This browser cannot show push notifications (they need https, or localhost).';
      default:
        return '…';
    }
  }
}
