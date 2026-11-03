import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { errorInterceptor } from '../data/error-interceptor';
import { User } from '../data/user';
import { DeleteUserDialog } from './delete-user-dialog';

const friend = { id: 7, username: 'friend' } as User;

describe('DeleteUserDialog', () => {
  let closed: unknown[];
  let backend: HttpTestingController;

  async function open() {
    closed = [];
    TestBed.configureTestingModule({
      imports: [DeleteUserDialog],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: friend },
        { provide: MatDialogRef, useValue: { close: (result?: unknown) => closed.push(result) } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DeleteUserDialog);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return {
      element,
      deleteButton: () => element.querySelector<HTMLButtonElement>('button.delete')!,
      type: async (value: string) => {
        const input = element.querySelector<HTMLInputElement>('input')!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
        await fixture.whenStable();
      },
      settle: () => fixture.whenStable(),
    };
  }

  afterEach(() => backend.verify());

  it('says it is for good, and deletes only once the username is typed again', async () => {
    const dialog = await open();
    expect(dialog.element.querySelector('h2')?.textContent?.trim()).toBe('Delete “friend”?');
    expect(dialog.element.querySelector('p')?.textContent).toContain('cannot be undone');
    expect(dialog.deleteButton().disabled).toBe(true);

    await dialog.type('frien');
    expect(dialog.deleteButton().disabled).toBe(true);
    await dialog.type('Friend ');
    expect(dialog.deleteButton().disabled).toBe(false);

    dialog.deleteButton().click();
    backend.expectOne({ method: 'DELETE', url: '/api/admin/users/7' }).flush(null, { status: 204, statusText: 'No Content' });
    await dialog.settle();
    expect(closed).toEqual([true]);
  });

  it('on an error it stays open and says why', async () => {
    const dialog = await open();
    await dialog.type('friend');
    dialog.deleteButton().click();
    backend.expectOne('/api/admin/users/7').flush(
      { type: 'urn:vtiger-reader:problem:last-administrator', title: 'Conflict', status: 409, detail: 'This is the last administrator who can sign in: make another one first', errors: [] },
      { status: 409, statusText: 'Conflict' },
    );
    await dialog.settle();

    expect(closed).toEqual([]);
    expect(dialog.element.querySelector('.error')?.textContent?.trim()).toBe(
      'Could not delete: This is the last administrator who can sign in: make another one first (409)',
    );
  });
});
