import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { of } from 'rxjs';

import { TicketsApi } from '../../data/tickets-api';
import { MailView, cidNames, rawDocument, remoteImages } from './mail-view';

describe('the Raw view’s page', () => {
  const html = `<meta http-equiv="refresh" content="0;url=https://evil.example"><p>Ciao</p><img src="cid:image001.png@01DA.1"><img src="https://tracker.example/p.gif"><base href="https://x">`;

  it('runs nothing and loads nothing but its own images, until remote images are asked for', () => {
    const page = rawDocument(html, { 'image001.png': 'data:image/png;base64,AAAA' }, false);
    expect(page).toContain(
      `content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"`,
    );
    expect(page).toContain('<img src="data:image/png;base64,AAAA">');
    expect(page).not.toContain('http-equiv="refresh"');
    expect(page).not.toContain('<base href="https://x">');
    expect(page).toContain('<base target="_blank">');
    expect(rawDocument(html, {}, true)).toContain('img-src data: https:');
  });

  it('finds the cid: images and counts the remote ones', () => {
    expect(cidNames(html)).toEqual(['image001.png']);
    expect(remoteImages(html)).toBe(1);
  });
});

describe('MailView', () => {
  async function render(inputs: Record<string, unknown>) {
    TestBed.configureTestingModule({
      imports: [MailView],
      providers: [
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: TicketsApi,
          useValue: { file: () => of(new Blob(['x'], { type: 'image/png' })) },
        },
      ],
    });
    const fixture = TestBed.createComponent(MailView);
    fixture.componentRef.setInput('ticketId', '17x1');
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const choose = async (mode: string) => {
      [...element.querySelectorAll<HTMLButtonElement>('mat-button-toggle button')]
        .find((b) => b.textContent?.trim() === mode)!
        .click();
      await fixture.whenStable();
    };
    return { element, choose };
  }

  it('Clean first: the words, and that something was hidden', async () => {
    const page = await render({
      text: 'La stampante non stampa.',
      cut: true,
      html: '<p>La stampante non stampa.</p><p>Mario</p>',
    });
    expect(page.element.querySelector('.clean')?.textContent).toBe('La stampante non stampa.');
    expect(page.element.querySelector('.hint')?.textContent).toContain('hidden');
  });

  it('Raw: the original in a sandboxed frame without scripts; Source: the HTML as text', async () => {
    const page = await render({
      text: 'x',
      html: '<p>Ciao</p><img src="https://t.example/a.gif">',
    });
    await page.choose('Raw');
    const frame = page.element.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox');
    expect(frame.getAttribute('srcdoc')).toContain('<p>Ciao</p>');
    expect(page.element.querySelector('.load-images')?.textContent).toContain(
      'Load 1 remote image',
    );
    await page.choose('Source');
    expect(page.element.querySelector('.source')?.textContent).toBe(
      '<p>Ciao</p><img src="https://t.example/a.gif">',
    );
  });

  it('no text of its own: says to look at Raw', async () => {
    const page = await render({ text: '', html: '<img src="cid:x.png">' });
    expect(page.element.querySelector('.clean.empty')).not.toBeNull();
  });
});
