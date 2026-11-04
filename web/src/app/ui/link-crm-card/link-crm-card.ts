import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';


/** In place of the tickets while the user has no CRM account linked: one card, to Settings. */
@Component({
  selector: 'app-link-crm-card',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    <section class="card">
      <mat-icon class="big" aria-hidden="true">link</mat-icon>
      <h1 class="headline">Link your CRM account</h1>
      <p class="text">
        The tickets are read from your own CRM account: its address, your username and your access
        key.
      </p>
      <a mat-flat-button routerLink="/settings">Settings</a>
    </section>
  `,
  styles: `
    :host {
      box-sizing: border-box;
      min-height: 60dvh;
      display: grid;
      place-items: center;
      padding: 16px;
    }
    .card {
      box-sizing: border-box;
      width: 100%;
      max-width: 380px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 24px;
      border-radius: 28px;
      background: var(--mat-sys-surface-container-low);
      border: var(--app-border) solid var(--mat-sys-outline-variant);
    }
    .big {
      color: var(--mat-sys-primary);
    }
    .headline {
      margin: 0;
      font: var(--mat-sys-headline-small);
      color: var(--mat-sys-on-surface);
    }
    .text {
      margin: 0 0 12px;
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class LinkCrmCard {}
