import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

import { Session } from '../session/session';

/**
 * The start page: the CRM's tickets. Until the CRM link and client exist (plan.md, step 2), it says
 * what comes next and points to the settings.
 */
@Component({
  selector: 'app-tickets-page',
  imports: [MatButtonModule, RouterLink],
  templateUrl: './tickets-page.html',
  styleUrl: './tickets-page.css',
})
export class TicketsPage {
  protected readonly session = inject(Session);
}
