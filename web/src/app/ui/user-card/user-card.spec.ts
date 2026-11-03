import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';

import { User } from '../../data/user';
import { UserCard } from './user-card';

const friend: User = {
  id: 7,
  username: 'friend',
  email: 'friend@dev.invalid',
  role: 'user',
  blocked: false,
  hasPassword: true,
  createdAt: '2026-10-03T09:00:00Z',
};

describe('UserCard', () => {
  let fixture: ComponentFixture<UserCard>;
  let said: string[];
  const element = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => element().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
  const tags = () => Array.from(element().querySelectorAll('.tag')).map((t) => t.textContent?.trim());
  const menuItems = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-panel button[mat-menu-item]'));

  async function render(user: User, self = false): Promise<void> {
    TestBed.configureTestingModule({
      imports: [UserCard],
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    fixture = TestBed.createComponent(UserCard);
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('self', self);
    said = [];
    fixture.componentInstance.edit.subscribe(() => said.push('edit'));
    fixture.componentInstance.impersonate.subscribe(() => said.push('impersonate'));
    fixture.componentInstance.remove.subscribe(() => said.push('remove'));
    await fixture.whenStable();
  }

  it('shows username, email, role and when it was created', async () => {
    await render(friend);
    expect(text('.username')).toBe('friend');
    expect(text('.email')).toBe('friend@dev.invalid');
    expect(tags()).toEqual(['User']);
    expect(text('.created')).toBe('Created 3 Oct 2026');
  });

  it('says when the user is blocked, or has no password yet', async () => {
    await render({ ...friend, role: 'admin', blocked: true, hasPassword: false });
    expect(tags()).toEqual(['Administrator', 'Blocked', 'No password']);
  });

  it('its ⋮ menu asks to edit, impersonate or delete', async () => {
    await render(friend);
    element().querySelector<HTMLButtonElement>('button.more')!.click();
    await fixture.whenStable();
    expect(menuItems().map((b) => b.textContent?.trim())).toEqual(['editEdit', 'visibilityImpersonate', 'deleteDelete']);

    for (const item of menuItems()) {
      item.click();
      await fixture.whenStable();
      element().querySelector<HTMLButtonElement>('button.more')!.click();
      await fixture.whenStable();
    }
    expect(said).toEqual(['edit', 'impersonate', 'remove']);
  });

  it('a blocked user cannot be impersonated from the menu', async () => {
    await render({ ...friend, blocked: true });
    element().querySelector<HTMLButtonElement>('button.more')!.click();
    await fixture.whenStable();
    expect(menuItems()[1]!.disabled).toBe(true);
  });

  it('the signed-in administrator: "You", and no menu', async () => {
    await render({ ...friend, username: 'lenzi', role: 'admin' }, true);
    expect(element().querySelector('button.more')).toBeNull();
    expect(text('.you')).toBe('You');
  });
});
