import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthApi } from '../../data/auth-api';
import { Session } from '../../session/session';

/**
 * While an administrator impersonates a user (design-accounts.md, "impersonation"): a coloured bar
 * above the top bar, "Viewing as <username> · Exit", that cannot be closed. Exit gives the
 * administrator its own session back and returns to the admin view. An impersonation past its hour
 * has no way back (the API's known limit): then the sign-in page.
 */
@Component({
  selector: 'app-viewing-as-bar',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './viewing-as-bar.html',
  styleUrl: './viewing-as-bar.css',
})
export class ViewingAsBar {
  protected readonly session = inject(Session);
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);

  protected readonly leaving = signal(false);

  protected async exit(): Promise<void> {
    if (this.leaving()) return;
    this.leaving.set(true);
    try {
      await firstValueFrom(this.authApi.stopImpersonating());
    } catch {
      this.session.forget();
      await this.router.navigateByUrl('/login');
      this.leaving.set(false);
      return;
    }
    await this.session.reload();
    // Back to the admin view, under the administrator's own username.
    await this.router.navigateByUrl(this.session.path('/admin'));
    this.leaving.set(false);
  }
}
