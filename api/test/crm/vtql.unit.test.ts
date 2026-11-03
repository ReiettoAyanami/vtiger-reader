import { describe, expect, it } from 'vitest';
import { containsLiteral, countText, idLiteral, isRecordId, literal, name, selectText } from '../../src/modules/crm/vtql.js';

describe('VTQL values', () => {
  it('quotes a string, escaping quotes and backslashes, dropping ; and control characters', () => {
    expect(literal('Open')).toBe("'Open'");
    expect(literal("Supporto all'utente")).toBe("'Supporto all\\'utente'");
    expect(literal('a\\b')).toBe("'a\\\\b'");
    expect(literal("x'; DELETE")).toBe("'x\\'  DELETE'");
    expect(literal('a\nb')).toBe("'a b'");
  });

  it('takes record ids only in their form: digits x digits', () => {
    expect(isRecordId('17x1234')).toBe(true);
    for (const bad of ['17x', 'x12', '17x12 OR 1=1', "17x1'", '']) {
      expect(isRecordId(bad), bad).toBe(false);
      expect(() => idLiteral(bad)).toThrow();
    }
    expect(idLiteral('17x1234')).toBe("'17x1234'");
  });

  it('a LIKE search keeps the words only (no wildcards, quotes or backslashes), 60 characters at most', () => {
    expect(containsLiteral('  stampante   non stampa ')).toBe("'%stampante non stampa%'");
    expect(containsLiteral("100% l'ufficio_2\\x\";")).toBe("'%100 l ufficio 2 x%'");
    expect(containsLiteral('a'.repeat(100))).toBe(`'%${'a'.repeat(60)}%'`);
  });

  it('module and field names are letters, digits and _', () => {
    expect(name('cf_acf_rtf_soluzione_ticket')).toBe('cf_acf_rtf_soluzione_ticket');
    for (const bad of ['ticket_no,password', 'HelpDesk;', '1x', 'a b', '']) expect(() => name(bad), bad).toThrow();
  });
});

describe('selectText', () => {
  it('always selects id, once, then the fields; LIMIT n, or LIMIT offset, n', () => {
    expect(selectText({ module: 'HelpDesk', fields: ['ticket_no', 'id', 'ticket_title'] })).toBe(
      'SELECT id, ticket_no, ticket_title FROM HelpDesk LIMIT 100;',
    );
    expect(
      selectText({
        module: 'HelpDesk',
        fields: ['ticket_no'],
        where: `ticketstatus = ${literal('Open')}`,
        orderBy: { field: 'createdtime', direction: 'DESC' },
        offset: 200,
        limit: 50,
      }),
    ).toBe("SELECT id, ticket_no FROM HelpDesk WHERE ticketstatus = 'Open' ORDER BY createdtime DESC LIMIT 200, 50;");
  });

  it('never asks for more than the CRM gives (100), nor less than 1', () => {
    expect(selectText({ module: 'HelpDesk', fields: [], limit: 500 })).toBe('SELECT id FROM HelpDesk LIMIT 100;');
    expect(selectText({ module: 'HelpDesk', fields: [], limit: 0, offset: -5 })).toBe('SELECT id FROM HelpDesk LIMIT 1;');
  });

  it('counts', () => {
    expect(countText('HelpDesk')).toBe('SELECT count(*) FROM HelpDesk;');
    expect(countText('HelpDesk', "assigned_user_id = '19x5'")).toBe("SELECT count(*) FROM HelpDesk WHERE assigned_user_id = '19x5';");
  });
});
