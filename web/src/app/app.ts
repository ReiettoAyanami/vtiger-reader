import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { DesktopBridge } from './desktop/desktop-bridge';
import { Sidebar } from './sidebar/sidebar';
import { Appearance } from './ui/appearance';
import { Bell } from './ui/bell/bell';
import { VersionLabel } from './ui/version-label/version-label';

/** The title of the deepest active route that has one. */
function routeTitle(route: ActivatedRouteSnapshot): string {
  let title = route.title ?? '';
  for (let child = route.firstChild; child; child = child.firstChild) title = child.title ?? title;
  return title;
}

/**
 * App shell, as in substance-tracker: the sidebar with the pages, the top bar with the current route's
 * title and the bell, and the routes. The sidebar is a drawer on every screen, opened from the top
 * bar, closed after a tap on a link.
 */
@Component({
  selector: 'app-root',
  imports: [
    Bell,
    MatButtonModule,
    MatIconModule,
    MatSidenavModule,
    MatToolbarModule,
    RouterOutlet,
    Sidebar,
    VersionLabel,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly router = inject(Router);

  /** The look this browser chose (Reduce transparency), applied from the first page, not only in /settings. */
  private readonly appearance = inject(Appearance);

  private readonly navigated$ = this.router.events.pipe(filter((event) => event instanceof NavigationEnd));

  protected readonly title = toSignal(this.navigated$.pipe(map(() => routeTitle(this.router.routerState.snapshot.root))), {
    initialValue: '',
  });

  constructor() {
    // The desktop app: a notification clicked while the window is open opens its ticket here.
    inject(DesktopBridge).listen();
  }

  /**
   * The menu button opens the drawer. Its origin goes with it: closing gives the focus back to the
   * button, with a focus ring only when the drawer was opened from the keyboard (a click from a
   * keyboard has detail 0).
   */
  protected openSidebar(sidebar: MatSidenav, click: MouseEvent): void {
    void sidebar.open(click.detail === 0 ? 'keyboard' : 'mouse');
  }

  /** A link of the sidebar was tapped: the drawer closes. */
  protected navigated(sidebar: MatSidenav): void {
    void sidebar.close();
  }
}
