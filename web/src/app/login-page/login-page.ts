import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, FormGroupDirective, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router } from '@angular/router';

import type { ApiError } from '../data/api-error';
import { Session } from '../session/session';

/** A sign-in that takes longer than this says why it may be waiting. */
const SLOW_AFTER_MS = 1500;

/** What a refused sign-in says: never which of the two was wrong. */
function messageOf(error: unknown): string {
  const problem = error as Partial<ApiError> | null;
  switch (problem?.status) {
    case null:
      return 'The server cannot be reached. Check the connection and try again.';
    case 401:
      return 'Wrong username or password.';
    case 403:
      // Better Auth's code for a blocked account is "banned-user"; ours for another address, "origin".
      return problem.code === 'origin'
        ? 'Signing in works only from the address of the app: this one is not it.'
        : 'This account is blocked: ask your administrator.';
    case 422:
      return 'That is not a username: only letters, digits, - and _ (not the email address).';
    case 429:
      return 'Too many attempts: wait a few seconds, then try again.';
    default:
      return problem?.detail || 'Signing in did not work. Try again.';
  }
}

/**
 * The sign-in page (design-accounts.md, "Web: /login"): username and password, nothing else. There
 * is no sign-up and no password reset by email: a forgotten password is reset by an administrator.
 * Signed in, the user goes back where they were going (`next`, only if it is one of their own
 * pages, or the admin view for an administrator), else to their own start page.
 */
@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPage {
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  /** The form's directive: resetting through it also forgets the submit, so no field turns red. */
  private readonly formDirective = viewChild.required(FormGroupDirective);
  private readonly passwordInput = viewChild.required<ElementRef<HTMLInputElement>>('password');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The answer is taking a while: after wrong passwords in a row the API waits before it checks. */
  protected readonly slow = signal(false);

  protected async signIn(): Promise<void> {
    if (this.busy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { username, password } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    const slowTimer = setTimeout(() => this.slow.set(true), SLOW_AFTER_MS);
    try {
      const user = await this.session.signIn(username.trim(), password);
      if (!user) throw { status: null } satisfies Partial<ApiError>;
      const home = this.session.path();
      const next = this.route.snapshot.queryParamMap.get('next');
      const under = (root: string) => next !== null && (next === root || next.startsWith(`${root}/`) || next.startsWith(`${root}?`));
      // The admin view is one of the user's own pages too (/<username>/admin).
      const own = under(home);
      await this.router.navigateByUrl(own && next ? next : home, { replaceUrl: true });
    } catch (error) {
      this.error.set(messageOf(error));
      // The password goes, the username stays; no field in error next to the message.
      this.formDirective().resetForm({ username, password: '' });
      this.passwordInput().nativeElement.focus();
      this.busy.set(false);
    } finally {
      clearTimeout(slowTimer);
      this.slow.set(false);
    }
  }
}
