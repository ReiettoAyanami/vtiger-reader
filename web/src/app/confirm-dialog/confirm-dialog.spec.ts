import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Observable, Subject, of, throwError } from 'rxjs';

import { ApiError } from '../data/api-error';
import { ConfirmDialog, ConfirmDialogData } from './confirm-dialog';

describe('ConfirmDialog', () => {
  let fixture: ComponentFixture<ConfirmDialog>;
  let closedWith: unknown[];
  let runs: number;

  const element = () => fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    Array.from(element().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label)!;

  async function open(answer: () => Observable<unknown>): Promise<void> {
    closedWith = [];
    runs = 0;
    const data: ConfirmDialogData = {
      title: 'Delete this consumption?',
      message: 'Its quantity goes back to its batch.',
      confirm: 'Delete',
      action: () => {
        runs++;
        return answer();
      },
    };
    TestBed.configureTestingModule({
      imports: [ConfirmDialog],
      providers: [
        { provide: MatDialogRef, useValue: { close: (value?: unknown) => closedWith.push(value) } },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(ConfirmDialog);
    await fixture.whenStable();
  }

  it('asks, runs the action on confirm and closes with true once it succeeded', async () => {
    const pending = new Subject<void>();
    await open(() => pending);

    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Delete this consumption?');
    expect(element().querySelector('p')?.textContent?.trim()).toBe('Its quantity goes back to its batch.');
    button('Delete').click();
    button('Delete').click(); // a double tap runs it once
    await fixture.whenStable();
    expect(runs).toBe(1);
    expect(button('Delete').disabled).toBe(true);
    expect(closedWith).toEqual([]);

    pending.next();
    expect(closedWith).toEqual([true]);
  });

  it('stays open on a failure, says why, and can try again', async () => {
    const refused: ApiError = {
      status: 409,
      code: 'batch-deactivated',
      title: 'Conflict',
      detail: 'Batch 8 is deactivated (remaining reached 0)',
      fieldErrors: [],
    };
    await open(() => throwError(() => refused));

    button('Delete').click();
    await fixture.whenStable();

    expect(closedWith).toEqual([]);
    expect(element().querySelector('.error')?.textContent?.trim()).toBe('Batch 8 is deactivated (remaining reached 0) (409)');
    expect(button('Delete').disabled).toBe(false);
  });

  it('closes with nothing on Cancel, running nothing', async () => {
    await open(() => of(null));
    button('Cancel').click();

    expect(runs).toBe(0);
    expect(closedWith).toEqual([undefined]);
  });
});
