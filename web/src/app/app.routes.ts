import { Routes } from '@angular/router';

// Every page is loaded when it is first opened (its own chunk): the initial bundle stays the shell.
// One profile, no accounts (plan 7.1): the pages sit at the root, without a username.
export const routes: Routes = [
  // The start page: the tickets.
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./tickets-page/tickets-page').then((m) => m.TicketsPage),
    title: 'Tickets',
  },
  // One ticket of the CRM, by its CRM id (17x1234).
  {
    path: 'tickets/:id',
    loadComponent: () => import('./ticket-page/ticket-page').then((m) => m.TicketPage),
    title: 'Ticket',
  },
  {
    path: 'settings',
    loadComponent: () => import('./settings-page/settings-page').then((m) => m.SettingsPage),
    title: 'Settings',
  },
  // Anything else: an old address, a typo.
  {
    path: '**',
    loadComponent: () => import('./not-found-page/not-found-page').then((m) => m.NotFoundPage),
    title: 'Not found',
  },
];
