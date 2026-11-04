import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';

import { NotificationsApi } from '../../data/notifications-api';
import { TicketRow } from '../../data/tickets';
import { LiveNotifications } from '../../notifications/live-notifications';
import { WhenPipe } from '../when';

/**
 * The bell in the top bar (plan 5.3): the tickets created since the user last opened it, read from
 * the CRM, again at every live event. Opening it shows them and marks them seen; a tap opens one.
 * Hidden while notifications are off, and when the bell cannot be read (no CRM link, CRM down).
 */
@Component({
  selector: 'app-bell',
  imports: [MatBadgeModule, MatButtonModule, MatIconModule, MatMenuModule, RouterLink, WhenPipe],
  templateUrl: './bell.html',
  styleUrl: './bell.css',
})
export class Bell {
  private readonly api = inject(NotificationsApi);
  private readonly live = inject(LiveNotifications);

  protected readonly bell = rxResource({
    params: () => ({ arrivals: this.live.arrivals() }),
    stream: () => this.api.bell(),
  });

  protected readonly enabled = computed(() => this.bell.hasValue() && this.bell.value().enabled);
  private readonly fresh = computed(() => (this.bell.hasValue() ? this.bell.value().items : []));
  protected readonly count = computed(() => this.fresh().length);

  /** What the open menu shows: the tickets as they were when it opened (seen meanwhile). */
  protected readonly shown = signal<TicketRow[]>([]);

  protected opened(): void {
    const items = this.fresh();
    this.shown.set(items);
    const newest = items.find((t) => t.createdAt)?.createdAt;
    if (!newest) return;
    this.api.seen(newest).subscribe({
      // The count goes to 0 (or to what arrived since) at once.
      next: () => this.bell.reload(),
      error: () => undefined,
    });
  }

  protected ticketPath(ticket: TicketRow): string {
    return `/tickets/${ticket.id}`;
  }
}
