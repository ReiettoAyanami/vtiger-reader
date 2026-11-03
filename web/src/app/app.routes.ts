import { Routes } from '@angular/router';

import { adminGuard } from './session/admin-guard';
import { homeGuard } from './session/home-guard';
import { signedOutGuard } from './session/signed-out-guard';
import { userGuard } from './session/user-guard';

const notFound = {
  loadComponent: () => import('./not-found-page/not-found-page').then((m) => m.NotFoundPage),
  title: 'Not found',
};

// Every page is loaded when it is first opened (its own chunk): the initial bundle stays the shell.
export const routes: Routes = [
  // Signing in: a page of its own, without the app around it.
  {
    path: 'login',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./login-page/login-page').then((m) => m.LoginPage),
    title: 'Sign in',
    data: { bare: true },
  },
  // The bare address: one's own pages, or the sign-in page.
  { path: '', pathMatch: 'full', canActivate: [homeGuard], children: [] },
  // A user's pages live under their username; another username does not match and lands on the
  // 404 page below, like any address that does not exist.
  {
    path: ':username',
    canMatch: [userGuard],
    children: [
      // The start page: the tickets.
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./tickets-page/tickets-page').then((m) => m.TicketsPage),
        title: 'Tickets',
      },
      // One ticket of the user's CRM, by its CRM id (17x1234).
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
      // The admin view, under the administrator's own username. A user, or an impersonation, gets
      // the 404 page below.
      {
        path: 'admin',
        canMatch: [adminGuard],
        loadComponent: () => import('./admin-page/admin-page').then((m) => m.AdminPage),
        title: 'Admin',
      },
      { path: '**', ...notFound },
    ],
  },
  // Anything else: an old address, a typo, another user's page.
  { path: '**', ...notFound },
];
