import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerOf } from '../../src/shared/owner.js';
import { makeApi, type Api } from '../support/api.js';
import { rawRows } from '../support/db.js';

let api: Api;
beforeAll(async () => {
  api = await makeApi();
});
afterAll(async () => {
  await api.app.close();
});

describe('a new user is ready to use', () => {
  it('the first administrator: credentials and the default settings', async () => {
    const id = await api.app.accounts.createUser(
      { username: 'lenzi', email: 'lenzi@dev.invalid', password: 'Lenzi-pass-0001', role: 'admin' },
      null,
    );
    expect(await rawRows('SELECT username, role FROM users WHERE id = ?', [id])).toEqual([{ username: 'lenzi', role: 'admin' }]);
    expect(await rawRows('SELECT language, timezone FROM user_settings WHERE user_id = ?', [id])).toEqual([
      { language: 'en', timezone: 'Europe/Rome' },
    ]);
  });

  it('another user gets the settings of the administrator who creates it', async () => {
    const adminId = await api.app.accounts.createUser(
      { username: 'boss', email: 'boss@dev.invalid', password: 'Boss-pass-000001', role: 'admin' },
      null,
    );
    await rawRows("UPDATE user_settings SET timezone = 'Europe/London' WHERE user_id = ?", [adminId]);
    const id = await api.app.accounts.createUser(
      { username: 'friend', email: 'friend@dev.invalid', password: 'Friend-pass-0001', role: 'user' },
      ownerOf(adminId),
    );
    expect(await rawRows('SELECT language, timezone FROM user_settings WHERE user_id = ?', [id])).toEqual([
      { language: 'en', timezone: 'Europe/London' },
    ]);
  });

  it('when the user cannot be created, nothing of it is left', async () => {
    await api.app.accounts.createUser({ username: 'taken', email: 'taken@dev.invalid', password: 'Taken-pass-00001', role: 'user' }, null);
    await expect(
      api.app.accounts.createUser({ username: 'taken', email: 'other@dev.invalid', password: 'Taken-pass-00001', role: 'user' }, null),
    ).rejects.toMatchObject({ status: 409 });
    expect(await rawRows('SELECT COUNT(*) AS n FROM users')).toEqual([{ n: 1 }]);
    expect(await rawRows('SELECT COUNT(*) AS n FROM user_settings')).toEqual([{ n: 1 }]);
  });
});

describe('deleting a user', () => {
  it('leaves no row with its user_id in any table', async () => {
    const id = await api.app.accounts.createUser(
      { username: 'leaving', email: 'leaving@dev.invalid', password: 'Leaving-pass-001', role: 'user' },
      null,
    );
    await rawRows(
      "INSERT INTO crm_link (user_id, crm_url, crm_username, access_key_sealed, crm_user_id) VALUES (?, 'https://crm.example.invalid', 'leaving', 'v1.a.b.c', '19x9')",
      [id],
    );
    await api.app.accounts.deleteUser(id);
    const tables = await rawRows(
      `SELECT TABLE_NAME AS t FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'user_id' ORDER BY TABLE_NAME`,
    );
    for (const { t } of tables) {
      expect(await rawRows(`SELECT COUNT(*) AS n FROM \`${String(t)}\` WHERE user_id = ?`, [id]), String(t)).toEqual([{ n: 0 }]);
    }
    expect(await rawRows('SELECT COUNT(*) AS n FROM users WHERE id = ?', [id])).toEqual([{ n: 0 }]);
  });
});
