import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddButton } from './add-button';

describe('AddButton', () => {
  let fixture: ComponentFixture<AddButton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddButton],
    }).compileComponents();
    fixture = TestBed.createComponent(AddButton);
    fixture.componentRef.setInput('label', 'Add user');
    await fixture.whenStable();
  });

  it('is a "+" button named by its label that says when it is pressed', () => {
    let pressed = 0;
    fixture.componentInstance.pressed.subscribe(() => pressed++);

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.getAttribute('aria-label')).toBe('Add user');
    expect(button.querySelector('mat-icon')?.textContent?.trim()).toBe('add');

    button.click();
    expect(pressed).toBe(1);
  });
});
