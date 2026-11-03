import { Location, PlatformLocation } from '@angular/common';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialogRef } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';

import { HistoryDialogs } from './history-dialogs';

@Component({ template: '<button type="button" (click)="close()">Done</button>' })
class Answering {
  private readonly ref = inject<MatDialogRef<Answering, string>>(MatDialogRef);
  close(): void {
    this.ref.close('answer');
  }
}

@Component({ template: '' })
class Blank {}

describe('HistoryDialogs', () => {
  let dialogs: HistoryDialogs;
  let location: Location;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'page', component: Blank },
          { path: 'elsewhere', component: Blank },
          // a page whose guard takes a while, like the sign-in page's (it asks the server who this is)
          { path: 'slow', canActivate: [() => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 30))], component: Blank },
        ]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    dialogs = TestBed.inject(HistoryDialogs);
    location = TestBed.inject(Location);
  });

  it('gives a dialog its own history entry, removed when it closes some other way than back', async () => {
    const closed = dialogs.open<Answering, object, string>(Answering, {});
    expect(location.getState()).toEqual({ dialog: true });

    document.querySelector<HTMLButtonElement>('mat-dialog-container button')!.click();
    expect(await closed).toBe('answer');
    expect(location.getState()).not.toEqual({ dialog: true });
  });

  it('a navigation started as soon as it resolves reaches its page, also a slow one: the back that removed the entry does not cancel it', async () => {
    const router = TestBed.inject(Router);
    // As an app starts: the router also follows the browser's back (TestBed alone never asks it to).
    location.go('/page');
    router.initialNavigation();
    await vi.waitFor(() => expect(router.url).toBe('/page'));
    const closed = dialogs.open<Answering, object, string>(Answering, {});
    document.querySelector<HTMLButtonElement>('mat-dialog-container button')!.click();
    expect(await closed).toBe('answer');

    // what Sign out does once confirmed (lenzi, 2026-10-03: signed out, the app stayed on the page):
    // the router takes the back in a later task, and that back used to cancel this navigation
    void router.navigateByUrl('/slow');
    await vi.waitFor(() => expect(router.url).toBe('/slow'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(router.url).toBe('/slow');
  });

  it('a link in the dialog to another page closes it; the page takes its history entry, so back returns under the dialog', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/page');
    const closed = dialogs.open<Answering, object, string>(Answering, {});
    expect(location.getState()).toEqual(expect.objectContaining({ dialog: true }));

    // what a routerLink inside the dialog does (e.g. "choose the metrics", lenzi 2026-10-03); that
    // navigation is done again in place of the dialog's entry, so the first one ends at once
    void router.navigateByUrl('/elsewhere?section=consumption');
    expect(await closed).toBeUndefined();
    await vi.waitFor(() => expect(router.url).toBe('/elsewhere?section=consumption'));
    await vi.waitFor(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
    expect(location.getState()).not.toEqual(expect.objectContaining({ dialog: true }));

    // one back: the page that was under the dialog, not the dialog's leftover entry
    const back = new Promise((resolve) => {
      const popped = location.subscribe(() => {
        popped.unsubscribe();
        resolve(undefined);
      });
    });
    location.back();
    await back;
    expect(location.path()).toBe('/page');
    expect(location.getState()).not.toEqual(expect.objectContaining({ dialog: true }));
  });

  it('a change on the same page (its filters in the query) leaves the dialog open', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/page');
    void dialogs.open<Answering, object, string>(Answering, {});
    await router.navigateByUrl('/page?batchId=3');
    expect(document.querySelector('mat-dialog-container')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('mat-dialog-container button')!.click();
  });

  it('closes the dialog on back, without going back once more', async () => {
    const closed = dialogs.open<Answering, object, string>(Answering, {});
    const back = vi.spyOn(location, 'back');

    TestBed.inject(PlatformLocation).back(); // the browser's back, not the app's
    expect(await closed).toBeUndefined();
    expect(document.querySelector('mat-dialog-container')).toBeNull();
    expect(back).not.toHaveBeenCalled();
  });
});
