import { describe, expect, it } from 'vitest';
import { cidNames, cleanMail, decodeEntities, htmlToText, signerOf } from '../../src/modules/tickets/mail.js';

describe('htmlToText', () => {
  it('blocks become lines, tags and styles go, entities become characters', () => {
    const html = `<html><head><style>p{color:red}</style></head><body><p>Buongiorno,</p><div>la stampante &egrave; ferma&nbsp;da ieri.<br>Grazie</div><!-- x --></body></html>`;
    expect(htmlToText(html)).toBe('Buongiorno,\n\nla stampante è ferma da ieri.\nGrazie');
  });

  it('decodes numeric and named entities; leaves unknown ones', () => {
    expect(decodeEntities('&#8364; &#x20AC; &amp; &rsquo; &nope;')).toBe('€ € & ’ &nope;');
  });
});

describe('cleanMail', () => {
  it('cuts the quoted message, by Gmail’s HTML marker', () => {
    const html = `<div>Ok, grazie.</div><div class="gmail_quote"><div>Il giorno lun 3 nov 2026 Mario ha scritto:</div><blockquote>vecchio</blockquote></div>`;
    expect(cleanMail(html)).toEqual({ text: 'Ok, grazie.', cut: true });
  });

  it('cuts the quoted message by its words: Italian, English, Outlook headers', () => {
    const it1 = `<p>Il problema persiste anche oggi.</p><p>Il giorno lun 3 nov 2026 alle ore 10:00 Mario Rossi &lt;m@x.it&gt; ha scritto:</p><p>vecchio</p>`;
    expect(cleanMail(it1).text).toBe('Il problema persiste anche oggi.');
    const en = `<p>Still broken after the restart.</p><p>On Mon, Nov 3, 2026 at 10:00 AM Mario wrote:</p><p>old</p>`;
    expect(cleanMail(en).text).toBe('Still broken after the restart.');
    const outlook = `<p>Vi mando il log richiesto.</p><p>Da: Supporto &lt;s@x.it&gt;<br>Inviato: lunedì 3 novembre 2026 10:00<br>A: Mario<br>Oggetto: R: ticket</p><p>vecchio</p>`;
    expect(cleanMail(outlook).text).toBe('Vi mando il log richiesto.');
  });

  it('cuts the disclaimer, from its paragraph on', () => {
    const html = `<p>Allego la fattura.</p><p>Saluti</p><p>Questo messaggio e i suoi allegati sono riservati e destinati esclusivamente ai destinatari indicati.</p><p>ancora</p>`;
    expect(cleanMail(html)).toEqual({ text: 'Allego la fattura.\n\nSaluti', cut: true });
  });

  it('cuts the signature: the contact lines, with the name and role just above', () => {
    const html = [
      'Buongiorno,',
      'il server non risponde dalle 9.',
      'Potete verificare?',
      '',
      'Cordiali saluti,',
      'Mario Rossi',
      'Responsabile IT',
      'Tel. 0541 123456',
      'mario.rossi@example.com',
      'www.example.com',
    ].join('<br>');
    expect(cleanMail(html)).toEqual({ text: 'Buongiorno,\nil server non risponde dalle 9.\nPotete verificare?\n\nCordiali saluti,', cut: true });
  });

  it('a phone number in the body, far from the end, is not a signature', () => {
    const body = ['Richiamatemi al 333 1234567 per favore.', ...Array.from({ length: 20 }, (_, i) => `riga ${i + 1} del problema`)];
    expect(cleanMail(body.join('<br>'))).toEqual({ text: body.join('\n'), cut: false });
  });

  it('nothing to cut: the text as it is, cut false', () => {
    expect(cleanMail('<p>Solo testo.</p>')).toEqual({ text: 'Solo testo.', cut: false });
    expect(cleanMail('')).toEqual({ text: '', cut: false });
  });

  it('a mail that is only a quote keeps it (nothing of its own before)', () => {
    const html = `<div class="gmail_quote">Il giorno lun Mario ha scritto: testo</div>`;
    expect(cleanMail(html).text).toContain('testo');
  });

  it('very long text is shortened, with …', () => {
    const result = cleanMail(`<p>${'a'.repeat(50)}</p>`, 10);
    expect(result).toEqual({ text: `${'a'.repeat(10)}…`, cut: true });
  });
});

describe('cidNames', () => {
  it('the file names behind cid: images, once each', () => {
    const html = `<img src="cid:image001.png@01DA0000.11223344"><img src='cid:image002.jpg'><img src="cid:image001.png@01DA0000.11223344"><img src="https://x/y.png">`;
    expect(cidNames(html)).toEqual(['image001.png', 'image002.jpg']);
  });
});

describe('signerOf', () => {
  it('the name after the closing words, on one of the last lines', () => {
    expect(signerOf('<p>Ho riavviato il server.</p><p>Grazie,<br>Giacomo</p>')).toBe('Giacomo');
    expect(signerOf('<p>Fatto.</p><p>Cordiali saluti</p><p>Anna Verdi</p>')).toBe('Anna Verdi');
  });

  it('nothing without closing words, or with a line that is not a name', () => {
    expect(signerOf('<p>Ho riavviato il server.</p><p>Giacomo</p>')).toBe('');
    expect(signerOf('<p>Grazie,</p><p>il problema è risolto</p>')).toBe('');
    expect(signerOf('')).toBe('');
  });
});
