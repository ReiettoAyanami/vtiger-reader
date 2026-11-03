import { describe, expect, it } from 'vitest';
import { CrmClient, Semaphore, type CrmCredentials } from '../../src/modules/crm/client.js';
import { CrmError } from '../../src/modules/crm/webservice.js';
import { ownerOf, type Owner } from '../../src/shared/owner.js';
import { FakeCrm } from '../support/fake-crm.js';

const MARIO = ownerOf(1);
const ANNA = ownerOf(2);
const NOBODY = ownerOf(3);

const URL_ = new FakeCrm().url;
const ACCOUNTS = new Map<number, CrmCredentials>([
  [1, { url: URL_, username: 'mario.rossi', accessKey: 'AbCdEf0123456789' }],
  [2, { url: URL_, username: 'anna.bianchi', accessKey: 'ZyXwVu9876543210' }],
]);

function setup(options: { now?: () => number; hostAllowed?: (host: string) => Promise<boolean> } = {}) {
  const crm = new FakeCrm();
  const logins: Array<[number, string]> = [];
  const hosts: string[] = [];
  const client = new CrmClient({
    fetch: crm.fetch,
    hostAllowed: async (host) => (hosts.push(host), options.hostAllowed ? options.hostAllowed(host) : true),
    credentialsOf: async (owner: Owner) => ACCOUNTS.get(owner.userId) ?? null,
    onLogin: async (owner, login) => {
      logins.push([owner.userId, login.crmUserId]);
    },
    ...(options.now ? { now: options.now } : {}),
  });
  return { crm, client, logins, hosts };
}

describe('CrmClient', () => {
  it('logs in with md5(challenge + access key), and says when the CRM refuses the key', async () => {
    const { crm, client } = setup();
    expect(await client.login({ url: URL_, username: 'mario.rossi', accessKey: 'AbCdEf0123456789' })).toEqual({
      sessionName: expect.any(String),
      crmUserId: '19x5',
    });
    // The access key itself never travels: only its hash with the challenge.
    expect(JSON.stringify(crm.calls)).not.toContain('AbCdEf0123456789');
    const error = await client.login({ url: URL_, username: 'mario.rossi', accessKey: 'wrong' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CrmError);
    expect((error as CrmError).kind).toBe('credentials');
  });

  it('calls only public https addresses: checked before every login, nothing sent otherwise', async () => {
    const { crm, client, hosts } = setup({ hostAllowed: async (host) => host !== 'intranet.example.invalid' });
    for (const url of ['http://crm.example.invalid', 'https://intranet.example.invalid', 'not an address']) {
      const error = await client.login({ url, username: 'mario.rossi', accessKey: 'AbCdEf0123456789' }).catch((e: unknown) => e);
      expect((error as CrmError).kind, url).toBe('address');
    }
    expect(crm.calls).toEqual([]);
    await client.read(MARIO, 'listtypes');
    expect(hosts).toEqual(['intranet.example.invalid', 'crm.example.invalid']);
  });

  it('works in each user’s own session, reused while fresh, renewed after 10 minutes', async () => {
    let now = 0;
    const { crm, client, logins } = setup({ now: () => now });
    await client.read(MARIO, 'listtypes');
    await client.read(MARIO, 'listtypes');
    await client.read(ANNA, 'listtypes');
    expect(logins).toEqual([
      [1, '19x5'],
      [2, '19x7'],
    ]);
    const sessions = crm.calls.filter((c) => c.operation === 'listtypes').map((c) => c.params['sessionName']);
    expect(sessions[0]).toBe(sessions[1]);
    expect(sessions[2]).not.toBe(sessions[0]);

    now = 10 * 60_000;
    await client.read(MARIO, 'listtypes');
    expect(logins).toHaveLength(3);
  });

  it('logs in again, once, when the CRM has closed the session', async () => {
    const { crm, client, logins } = setup();
    await client.read(MARIO, 'listtypes');
    crm.closeSessions();
    await client.read(MARIO, 'listtypes');
    expect(logins).toHaveLength(2);
    expect(crm.operations()).toEqual(['getchallenge', 'login', 'listtypes', 'listtypes', 'getchallenge', 'login', 'listtypes']);
  });

  it('one login for many calls at once', async () => {
    const { client, logins } = setup();
    await Promise.all([client.read(MARIO, 'listtypes'), client.read(MARIO, 'listtypes'), client.read(MARIO, 'listtypes')]);
    expect(logins).toHaveLength(1);
  });

  it('a user without a linked account gets not-linked, and nothing is sent', async () => {
    const { crm, client } = setup();
    const error = await client.read(NOBODY, 'listtypes').catch((e: unknown) => e);
    expect((error as CrmError).kind).toBe('not-linked');
    expect(crm.calls).toEqual([]);
  });

  it('forget logs the session out, and the next call logs in again', async () => {
    const { crm, client, logins } = setup();
    await client.read(MARIO, 'listtypes');
    expect(crm.openSessions()).toBe(1);
    await client.forget(MARIO);
    expect(crm.openSessions()).toBe(0);
    await client.read(MARIO, 'listtypes');
    expect(logins).toHaveLength(2);
  });

  it('describe: the parts the app uses, kept per CRM user for an hour', async () => {
    let now = 0;
    const { crm, client } = setup({ now: () => now });
    const module = await client.describe(MARIO, 'HelpDesk');
    expect(module.label).toBe('Ticket');
    expect(module.fields.find((f) => f.name === 'ticketstatus')).toEqual({
      name: 'ticketstatus',
      label: 'Stato',
      type: 'picklist',
      refersTo: [],
      picklist: [
        { value: 'Open', label: 'Aperto' },
        { value: 'Closed', label: 'Chiuso' },
      ],
    });
    expect(module.fields.find((f) => f.name === 'parent_id')?.refersTo).toEqual(['Accounts']);
    await client.describe(MARIO, 'HelpDesk');
    await client.describe(ANNA, 'HelpDesk'); // another CRM user: their own profile, their own schema
    expect(crm.operations().filter((o) => o === 'describe')).toHaveLength(2);
    now = 60 * 60_000;
    await client.describe(MARIO, 'HelpDesk');
    expect(crm.operations().filter((o) => o === 'describe')).toHaveLength(3);
  });

  it('a value listed twice in a picklist is offered once', async () => {
    const { crm, client } = setup();
    crm.modules.set('HelpDesk', {
      name: 'HelpDesk',
      fields: [{ name: 'tipo_sla', label: 'Tipo SLA', type: { name: 'picklist', picklistValues: [{ value: 'Full', label: 'Full' }, { value: 'Full', label: 'Full' }, { value: 'Standard', label: 'Standard' }] } }],
    });
    expect((await client.describe(MARIO, 'HelpDesk')).fields[0]?.picklist.map((p) => p.value)).toEqual(['Full', 'Standard']);
  });

  it('the fake CRM refuses a query with a field it does not have, as the real one does', async () => {
    const { client } = setup();
    const error = await client.read(MARIO, 'query', { query: 'SELECT id, cf_not_here FROM HelpDesk LIMIT 1;' }).catch((e: unknown) => e);
    expect([(error as CrmError).kind, (error as CrmError).code]).toEqual(['denied', 'ACCESS_DENIED']);
  });

  it('select drops the fields this CRM does not have (it would refuse the whole query)', async () => {
    const { crm, client } = setup();
    const asked: string[] = [];
    crm.queryAnswer = (query) => {
      asked.push(query);
      return [{ id: '17x1', ticket_no: 'TT1' }];
    };
    const rows = await client.select(MARIO, { module: 'HelpDesk', fields: ['ticket_no', 'cf_not_here', 'ticket_title'], limit: 10 });
    expect(rows).toEqual([{ id: '17x1', ticket_no: 'TT1' }]);
    expect(asked).toEqual(['SELECT id, ticket_no, ticket_title FROM HelpDesk LIMIT 10;']);
  });

  it('count reads the CRM’s count row', async () => {
    const { crm, client } = setup();
    crm.queryAnswer = () => [{ count: '42' }];
    expect(await client.count(MARIO, 'HelpDesk')).toBe(42);
  });

  it('retrieve: a record, or null for an id the user may not see or that is not an id', async () => {
    const { crm, client } = setup();
    crm.records.set('11x9', { id: '11x9', accountname: 'Acme' });
    expect(await client.retrieve(MARIO, '11x9')).toEqual({ id: '11x9', accountname: 'Acme' });
    expect(await client.retrieve(MARIO, '11x10')).toBeNull();
    expect(await client.retrieve(MARIO, "11x9' OR 1")).toBeNull();
  });

  it('files: decoded from base64, at most 4 downloads at once', async () => {
    const { crm, client } = setup();
    crm.fileDelayMs = 20;
    for (let i = 1; i <= 8; i++) crm.files.set(`15x${i}`, { filename: `f${i}.txt`, filecontents: Buffer.from(`file ${i}`).toString('base64') });
    const files = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((i) => client.file(MARIO, `15x${i}`)));
    expect(files[2]).toEqual({ name: 'f3.txt', data: Buffer.from('file 3') });
    expect(crm.filesMost).toBe(4);
    // A file id the CRM does not have: RECORD_NOT_FOUND, null here.
    expect(await client.file(MARIO, '15x99')).toBeNull();
  });
});

describe('Semaphore', () => {
  it('runs at most n tasks at once, and frees a place when one fails', async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let most = 0;
    const task = (fail: boolean) => async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      if (fail) throw new Error('no');
      return 'ok';
    };
    const results = await Promise.allSettled([true, false, false, true, false].map((f) => semaphore.run(task(f))));
    expect(most).toBe(2);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled', 'rejected', 'fulfilled']);
  });
});
