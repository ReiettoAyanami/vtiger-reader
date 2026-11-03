import { Component, computed, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { ApiError } from '../data/api-error';
import { Attachment, Comment, whoLabel } from '../data/tickets';
import { TicketsApi } from '../data/tickets-api';
import { Session } from '../session/session';
import { statusColor } from '../ui/status-color';
import { WhenPipe } from '../ui/when';
import { AiPanel } from './ai-panel/ai-panel';
import { FilesView } from './files-view/files-view';
import { MailView } from './mail-view/mail-view';

/** The CRM actions, shown and not working yet (lenzi, 2026-11-03: "put every button but no functionality"). */
export const WRITE_ACTIONS = [
  { label: 'Reply', icon: 'reply' },
  { label: 'Comment', icon: 'add_comment' },
  { label: 'Take charge', icon: 'assignment_ind' },
  { label: 'Close', icon: 'task_alt' },
  { label: 'Edit', icon: 'edit' },
] as const;

function apiErrorOf(error: unknown): Partial<ApiError> | null {
  if (!error) return null;
  return ((error as { cause?: unknown }).cause ?? error) as Partial<ApiError>;
}

/**
 * One ticket (plan 3.3–3.8), read from the CRM each time it opens: its header, the request cleaned
 * (Raw a click away), the solution, the other fields, the comments in order with their files, the
 * documents. The attachments come after the ticket (they are downloaded to be measured). The
 * actions that would write to the CRM are there, disabled.
 */
@Component({
  selector: 'app-ticket-page',
  imports: [
    AiPanel,
    FilesView,
    MailView,
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    RouterLink,
    WhenPipe,
  ],
  templateUrl: './ticket-page.html',
  styleUrl: './ticket-page.css',
})
export class TicketPage {
  private readonly api = inject(TicketsApi);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(Session);

  protected readonly actions = WRITE_ACTIONS;
  protected readonly whoLabel = whoLabel;
  protected readonly statusColor = statusColor;

  protected readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), {
    requireSync: true,
  });
  protected readonly ticket = rxResource({
    params: () => this.id() || undefined,
    stream: ({ params }) => this.api.ticket(params),
  });
  protected readonly attachments = rxResource({
    params: () => (this.ticket.hasValue() ? this.id() : undefined),
    stream: ({ params }) => this.api.attachments(params),
  });

  /** The AI panel (plan 4.4): closed until asked for; closing it forgets its conversation. */
  protected readonly aiOpen = signal(false);
  /** Real photos (not signature logos): the panel offers "Look at the photos". */
  protected readonly hasPhotos = computed(() =>
    this.files().some((f) => f.type.startsWith('image/') && f.inline && !f.signature),
  );

  /** The first comment repeats the description (mail tickets): folded, shown on request. */
  protected readonly showRepeated = signal(false);

  protected readonly failure = computed(() => {
    const error = apiErrorOf(this.ticket.error());
    if (!error) return null;
    if (error.code === 'not-found' || error.status === 404)
      return 'This ticket does not exist, or your CRM account may not read it.';
    if (error.code === 'crm-not-linked')
      return 'Link your CRM account in Settings to read the tickets.';
    if (error.code === 'crm-unreachable' || error.status === null)
      return 'The CRM is not reachable right now.';
    return `Could not load the ticket: ${error.detail || error.title}${error.status ? ` (${error.status})` : ''}`;
  });

  /** The attachments, or none while they are read or could not be (reading an errored resource's value throws). */
  protected readonly files = computed(() =>
    this.attachments.hasValue() ? this.attachments.value() : [],
  );
  private readonly byId = computed(() => new Map(this.files().map((a) => [a.id, a])));

  /** The ticket's files that belong to nothing shown (none, usually): listed at the end. */
  protected filesOf(ids: readonly string[]): Attachment[] {
    return ids.flatMap((id) => this.byId().get(id) ?? []);
  }

  protected authorIcon(comment: Comment): string {
    switch (comment.author.kind) {
      case 'customer':
        return 'person';
      case 'me':
        return 'account_circle';
      case 'group':
        return 'groups';
      default:
        return 'support_agent';
    }
  }

  protected backLink(): string {
    return this.session.path();
  }
}
