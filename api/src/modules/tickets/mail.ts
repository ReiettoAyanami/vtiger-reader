/**
 * The words of a mail, without what is around them (plan 3.4): the HTML of a ticket's description or
 * of a comment becomes plain text, and the quoted messages, the legal disclaimers and the signature
 * are cut. Nothing is learned or kept from them; the original stays one click away (Raw, plan 3.5).
 *
 * The rules follow cerini-ia's `_crm_clean` (quoted text, disclaimers, the signature from the first
 * line with a phone, a mail, a site or a VAT number, with the name and role just above it), plus the
 * markers mail programs put in the HTML before a quoted message.
 */

export interface CleanText {
  /** The words, one paragraph per block, blank lines between paragraphs. */
  text: string;
  /** Something was cut (a quote, a disclaimer, a signature): the Raw view has more. */
  cut: boolean;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", agrave: 'à', aacute: 'á', egrave: 'è',
  eacute: 'é', igrave: 'ì', iacute: 'í', ograve: 'ò', oacute: 'ó', ugrave: 'ù', uacute: 'ú', Agrave: 'À',
  Egrave: 'È', Eacute: 'É', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù', ccedil: 'ç', ntilde: 'ñ', euro: '€',
  laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“',
  rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', ordm: 'º', ordf: 'ª',
  times: '×', shy: '', zwnj: '', zwj: '',
};

/** HTML entities as the characters they stand for (named ones of mails, decimal, hex). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * Where mail programs start a quoted message in the HTML: Gmail's quote, Outlook's reply header,
 * Apple Mail's cite, Thunderbird's prefix. The text-level rules below catch the rest.
 */
const HTML_QUOTE_START = [
  /<div[^>]*class=["'][^"']*gmail_quote[^"']*["']/i,
  /<div[^>]*id=["']divRplyFwdMsg["']/i,
  /<div[^>]*id=["']appendonsend["']/i,
  /<blockquote[^>]*type=["']cite["']/i,
  /<div[^>]*class=["'][^"']*moz-cite-prefix[^"']*["']/i,
  /<hr[^>]*id=["']stopSpelling["']/i,
];

/** The text of an HTML fragment: blocks become lines, tags go, entities become characters. */
export function htmlToText(html: string): string {
  let h = html.replace(/<(style|head|script|title|xml)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  h = h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote|pre)\s*>/gi, '\n').replace(/<(p|div|tr|li|h[1-6]|table)\b[^>]*>/gi, '\n');
  h = h.replace(/<\/t[dh]\s*>/gi, ' ');
  const text = decodeEntities(h.replace(/<[^>]+>/g, '')).replace(/ /g, ' ').replace(/\r\n?/g, '\n');
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lines that start a quoted message, in the text. */
const TEXT_QUOTE_START = [
  // "Il giorno lun 3 nov 2026 alle 10:00 Mario <m@x.it> ha scritto:" (it may wrap)
  /^(il giorno|in data)\b[\s\S]{3,240}?\bha scritto\s*:/im,
  /^on\b[\s\S]{3,240}?\bwrote\s*:/im,
  /^-{2,}\s*(original message|messaggio originale|forwarded message|messaggio inoltrato)\s*-{2,}/im,
  // Outlook's header: From/Da followed by Sent/Inviato or Date/Data within a few lines
  /^(from|da)\s*:[^\n]*\n(?:[^\n]*\n){0,3}?\s*(sent|inviato|date|data)\s*:/im,
  /^_{10,}\s*\n\s*(from|da)\s*:/im,
];

/** Paragraphs of legal boilerplate: from the first one to the end goes. */
const DISCLAIMER =
  /(questo messaggio|questa (e-?mail|comunicazione)|il presente messaggio|le informazioni contenute|this (e-?mail|message|communication))[\s\S]{0,300}?(riservat|confidenzial|destinatari|confidential|intended (solely|only)|privileged)|ai sensi (del|dell')\s*(d\.?\s?lgs|regolamento|gdpr|art)|rispetta l'ambiente|please consider the environment|pensa all'ambiente prima di stampare/i;

/** A line with a phone number, a mail address, a web site or a VAT number: where a signature starts. */
const CONTACT_LINE =
  /(\b(tel|telefono|cell|cellulare|mob|mobile|phone|fax|ph)\b\.?\s*[:.]?\s*\+?[\d\s/().-]{6,})|(\+\d{1,3}[\s.-]?\d[\d\s/.-]{6,})|(\b0\d{1,3}[\s/.-]?\d{5,8}\b)|(\b3\d{2}[\s.-]?\d{6,7}\b)|([\w.+-]+@[\w-]+(\.[\w-]+)+)|(\bwww\.[\w-]+\.[a-z]{2,}|https?:\/\/\S+)|(\b(p\.?\s?iva|partita iva|vat|c\.?\s?f\.)\b)/i;

/** How far from the end a signature may start: a phone or a mail in the body is not a signature. */
const SIGNATURE_WINDOW = 15;

/** The words of a mail or comment, cleaned; `maxLength` cuts what remains (with "…"). */
export function cleanMail(html: string, maxLength = 20_000): CleanText {
  let source = html ?? '';
  let cut = false;
  // 1. the quoted message, where the HTML marks it
  let quoteAt = -1;
  for (const marker of HTML_QUOTE_START) {
    const at = source.search(marker);
    if (at >= 0 && (quoteAt < 0 || at < quoteAt)) quoteAt = at;
  }
  if (quoteAt > 0 && htmlToText(source.slice(0, quoteAt)).length > 0) {
    source = source.slice(0, quoteAt);
    cut = true;
  }
  let text = htmlToText(source);

  // 2. the quoted message, by its words (after some text of its own)
  let textQuote = -1;
  for (const marker of TEXT_QUOTE_START) {
    const match = marker.exec(text);
    if (match && match.index > 20 && (textQuote < 0 || match.index < textQuote)) textQuote = match.index;
  }
  if (textQuote > 0) {
    text = text.slice(0, textQuote).trimEnd();
    cut = true;
  }

  // 3. the disclaimer, from its paragraph to the end
  const paragraphs = text.split(/\n\s*\n/);
  const firstDisclaimer = paragraphs.findIndex((p, i) => i > 0 && DISCLAIMER.test(p));
  if (firstDisclaimer > 0) {
    text = paragraphs.slice(0, firstDisclaimer).join('\n\n').trimEnd();
    cut = true;
  }

  // 4. the signature: from the first contact line near the end, with the name and role above it
  const lines = text.split('\n');
  const from = Math.max(1, lines.length - SIGNATURE_WINDOW);
  const contact = lines.findIndex((line, i) => i >= from && CONTACT_LINE.test(line));
  if (contact > 0) {
    let start = contact;
    while (start > 1 && contact - start < 4) {
      const above = lines[start - 1] ?? '';
      if (above.trim() === '' || above.length >= 50 || /[.!?:,;]$/.test(above.trim())) break;
      start--;
    }
    const kept = lines.slice(0, start).join('\n').trimEnd();
    if (kept.length > 0) {
      text = kept;
      cut = true;
    }
  }

  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength)}…`;
    cut = true;
  }
  return { text, cut };
}

/**
 * The file names behind the `cid:` images of an HTML mail (`image001.png@01DA...` → `image001.png`):
 * the attachments they stand for, found by name among the ticket's files.
 */
export function cidNames(html: string): string[] {
  const names = [...(html ?? '').matchAll(/src\s*=\s*["']cid:([^"']+)["']/gi)].map((m) => (m[1] ?? '').replace(/@.*$/, '').trim());
  return [...new Set(names.filter(Boolean))];
}
