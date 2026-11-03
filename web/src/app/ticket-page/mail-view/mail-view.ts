import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { catchError, firstValueFrom, of } from 'rxjs';

import { Attachment } from '../../data/tickets';
import { TicketsApi } from '../../data/tickets-api';

export type MailMode = 'clean' | 'raw' | 'source';

/** The file names behind the `cid:` images of a mail (`image001.png@01DA…` → `image001.png`). */
export function cidNames(html: string): string[] {
  const names = [...html.matchAll(/src\s*=\s*["']cid:([^"']+)["']/gi)].map((m) =>
    (m[1] ?? '').replace(/@.*$/, '').trim(),
  );
  return [...new Set(names.filter(Boolean))];
}

/** How many images a mail would load from elsewhere (a sender's tracking pixel, among others). */
export function remoteImages(html: string): number {
  return [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']?\s*https?:/gi)].length;
}

/**
 * The page the Raw view shows: the mail's own HTML, with a policy of its own on top of the app's
 * (both apply): nothing runs, nothing is fetched but its own images (`cid:` made `data:` here), and
 * remote ones only when the user asks. Links open in a new tab.
 */
export function rawDocument(
  html: string,
  images: Record<string, string>,
  loadRemote: boolean,
): string {
  const policy = `default-src 'none'; img-src data:${loadRemote ? ' https:' : ''}; style-src 'unsafe-inline'; font-src data:`;
  // The mail's own <meta> (a refresh would load a page in the frame), <base> and <link> go.
  const own = html.replace(/<(meta|base|link)\b[^>]*>/gi, '');
  const withImages = own.replace(
    /(src\s*=\s*["'])cid:([^"']+)(["'])/gi,
    (whole, open: string, cid: string, close: string) => {
      const data = images[cid.replace(/@.*$/, '').trim()];
      return data ? `${open}${data}${close}` : whole;
    },
  );
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><base target="_blank"><style>body{margin:12px;font:14px/1.45 system-ui,sans-serif;color:#1d1b20;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${withImages}</body></html>`;
}

/**
 * A mail or a comment (plan 3.4, 3.5): Clean (the words, without quotes, disclaimer and signature),
 * Raw (the original, as the sender wrote it, in a sandboxed frame), Source (its HTML as text).
 */
@Component({
  selector: 'app-mail-view',
  imports: [MatButtonModule, MatButtonToggleModule, MatIconModule],
  templateUrl: './mail-view.html',
  styleUrl: './mail-view.css',
})
export class MailView {
  private readonly api = inject(TicketsApi);
  private readonly sanitizer = inject(DomSanitizer);

  readonly ticketId = input.required<string>();
  readonly text = input.required<string>();
  readonly cut = input(false);
  readonly html = input.required<string>();
  /** The ticket's attachments: the `cid:` images of the Raw view are found among them, by name. */
  readonly attachments = input<Attachment[]>([]);
  /** A label for the frame and the toggle (e.g. "Description"). */
  readonly label = input('Mail');

  protected readonly mode = signal<MailMode>('clean');
  protected readonly loadRemote = signal(false);
  private readonly images = signal<Record<string, string>>({});

  protected readonly remoteCount = computed(() => remoteImages(this.html()));
  protected readonly isHtml = computed(() => /<[a-z][\s\S]*>/i.test(this.html()));

  /** The Raw view's page. Safe to give the frame: sandboxed (no scripts, no access to the app) and with its own policy. */
  protected readonly rawPage = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      rawDocument(this.html(), this.images(), this.loadRemote()),
    ),
  );

  constructor() {
    // The `cid:` images, made data: addresses, the first time the Raw view opens.
    effect(() => {
      if (this.mode() !== 'raw') return;
      const wanted = cidNames(this.html()).filter((name) => !(name in this.images()));
      const files = this.attachments();
      for (const name of wanted) {
        const file = files.find((a) => a.name === name && a.type.startsWith('image/'));
        if (!file) continue;
        void firstValueFrom(
          this.api.file(this.ticketId(), file.id).pipe(catchError(() => of(null))),
        ).then(async (blob) => {
          if (!blob) return;
          const data = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => resolve('');
            reader.readAsDataURL(new Blob([blob], { type: file.type }));
          });
          if (data) this.images.update((images) => ({ ...images, [name]: data }));
        });
      }
    });
  }
}
