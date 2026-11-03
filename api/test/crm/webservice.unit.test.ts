import { describe, expect, it } from 'vitest';
import { CrmError, READ_OPERATIONS, Webservice, crmBaseUrl, endpointOf, kindOf } from '../../src/modules/crm/webservice.js';
import { FakeCrm } from '../support/fake-crm.js';

function errorOf(promise: Promise<unknown>): Promise<CrmError> {
  return promise.then(
    () => {
      throw new Error('expected a CrmError');
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(CrmError);
      return error as CrmError;
    },
  );
}

describe('endpointOf', () => {
  it('adds /webservice.php to the address, however it was written', () => {
    for (const url of ['https://x.opencrmitalia.com', 'https://x.opencrmitalia.com/', 'https://x.opencrmitalia.com/webservice.php', ' https://x.opencrmitalia.com// ']) {
      expect(endpointOf(url)).toBe('https://x.opencrmitalia.com/webservice.php');
    }
    expect(endpointOf('https://example.com/crm/')).toBe('https://example.com/crm/webservice.php');
  });

  it('refuses what is not an https address', () => {
    for (const url of ['x.opencrmitalia.com', 'ftp://x.example.com', 'http://x.opencrmitalia.com']) expect(() => endpointOf(url), url).toThrow();
  });
});

describe('crmBaseUrl', () => {
  it('the address as stored: https, no trailing / or /webservice.php, the case of the host lowered', () => {
    expect(crmBaseUrl(' https://X.OpenCRMItalia.com/webservice.php ')).toBe('https://x.opencrmitalia.com');
    expect(crmBaseUrl('https://example.com/crm//')).toBe('https://example.com/crm');
    expect(crmBaseUrl('https://example.com:8443')).toBe('https://example.com:8443');
  });

  it('null for anything else: http, a user and password in it, a query, a fragment, no address', () => {
    for (const url of ['http://example.com', 'https://me:pw@example.com', 'https://example.com/?a=1', 'https://example.com/#x', 'example.com', '']) {
      expect(crmBaseUrl(url), url).toBeNull();
    }
  });
});

describe('Webservice', () => {
  it('is read-only: writing operations never leave the server', async () => {
    const crm = new FakeCrm();
    const ws = new Webservice({ url: crm.url, fetch: crm.fetch });
    for (const operation of ['create', 'update', 'revise', 'delete', 'sync', 'convertlead', 'extendsession']) {
      const error = await errorOf(ws.call(operation as never, {}));
      expect(error.kind).toBe('refused');
    }
    expect(crm.calls).toEqual([]);
    expect(READ_OPERATIONS).not.toContain('create');
  });

  it('sends login and logout as POST, everything else as GET with the parameters in the address', async () => {
    const crm = new FakeCrm();
    const ws = new Webservice({ url: crm.url, fetch: crm.fetch });
    await ws.call('getchallenge', { username: 'mario.rossi' });
    await errorOf(ws.call('login', { username: 'mario.rossi', accessKey: 'wrong' }));
    expect(crm.calls.map((c) => [c.method, c.operation, c.params['username']])).toEqual([
      ['GET', 'getchallenge', 'mario.rossi'],
      ['POST', 'login', 'mario.rossi'],
    ]);
  });

  it('turns the CRM errors into kinds: credentials, session, denied, failed', async () => {
    const crm = new FakeCrm();
    const ws = new Webservice({ url: crm.url, fetch: crm.fetch });
    await ws.call('getchallenge', { username: 'mario.rossi' });
    const credentials = await errorOf(ws.call('login', { username: 'mario.rossi', accessKey: 'nope' }));
    expect([credentials.kind, credentials.code]).toEqual(['credentials', 'INVALID_USER_CREDENTIALS']);
    expect((await errorOf(ws.call('query', { sessionName: 'gone', query: 'SELECT id FROM HelpDesk;' }))).kind).toBe('session');
    expect(kindOf('ACCESS_DENIED', 'Permission to perform the operation is denied')).toBe('denied');
    expect(kindOf('', 'Session expired')).toBe('session');
    expect(kindOf('QUERY_SYNTAX_ERROR', 'Syntax error')).toBe('failed');
  });

  it('a CRM that does not answer, or answers something else, is unreachable', async () => {
    const crm = new FakeCrm();
    crm.down = true;
    expect((await errorOf(new Webservice({ url: crm.url, fetch: crm.fetch }).call('listtypes'))).kind).toBe('unreachable');

    const html: typeof fetch = async () => new Response('<html>maintenance</html>', { status: 503 });
    expect((await errorOf(new Webservice({ url: crm.url, fetch: html }).call('listtypes'))).message).toContain('HTTP 503');

    const other: typeof fetch = async () => Response.json({ hello: 'world' });
    expect((await errorOf(new Webservice({ url: crm.url, fetch: other }).call('listtypes'))).kind).toBe('unreachable');
  });

  it('gives up after its timeout', async () => {
    const slow: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const ws = new Webservice({ url: 'https://crm.example.invalid', fetch: slow, timeoutMs: 20 });
    expect((await errorOf(ws.call('listtypes'))).kind).toBe('unreachable');
  });
});
