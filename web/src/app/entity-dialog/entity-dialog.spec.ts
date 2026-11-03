import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { EntityDialog, EntityDialogData } from './entity-dialog';

describe('EntityDialog', () => {
  let fixture: ComponentFixture<EntityDialog>;
  let closedWith: unknown[];

  const element = () => fixture.nativeElement as HTMLElement;

  async function open(data: EntityDialogData): Promise<void> {
    closedWith = [];
    TestBed.configureTestingModule({
      imports: [EntityDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: MatDialogRef, useValue: { close: (value?: unknown) => closedWith.push(value) } },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(EntityDialog);
    await fixture.whenStable();
  }

  it('shows the form of its one kind, with no selector', async () => {
    await open({ kinds: ['user'] });

    expect(element().querySelector('app-user-form')).not.toBeNull();
    expect(element().querySelector('mat-select.kind-select')).toBeNull();
  });

  it('closes with nothing when the form is cancelled', async () => {
    await open({ kinds: ['user'] });
    const cancel = [...element().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Cancel');
    cancel!.click();
    await fixture.whenStable();

    expect(closedWith).toEqual([undefined]);
  });
});
