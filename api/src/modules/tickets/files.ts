import { createHash } from 'node:crypto';
import sharp from 'sharp';

/**
 * A ticket's attachments (plan 3.6, 3.7): their type from the bytes, not from the name (the CRM's
 * own `filetype` says application/pdf for a spreadsheet), and for images the size and a
 * fingerprint, to set the signature images aside.
 */

/** The type of a file, from its first bytes; the name only tells Office files apart. */
export function sniffType(data: Buffer, name: string): string {
  const hex = data.subarray(0, 12).toString('hex');
  const ascii = data.subarray(0, 12).toString('latin1');
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (ascii.startsWith('GIF8')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('BM')) return 'image/bmp';
  if (hex.startsWith('49492a00') || hex.startsWith('4d4d002a')) return 'image/tiff';
  if (ascii.slice(4, 12) === 'ftypheic' || ascii.slice(4, 12) === 'ftypmif1' || ascii.slice(4, 12) === 'ftypheix') return 'image/heic';
  if (ascii.startsWith('%PDF')) return 'application/pdf';
  if (hex.startsWith('504b0304')) {
    const office: Record<string, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    return office[ext] ?? 'application/zip';
  }
  if (hex.startsWith('d0cf11e0')) {
    const legacy: Record<string, string> = { doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint', msg: 'application/vnd.ms-outlook' };
    return legacy[ext] ?? 'application/octet-stream';
  }
  return 'application/octet-stream';
}

/**
 * The types a browser may show in the app's own address: images it draws and PDFs. Anything else
 * (HTML, SVG, scripts, Office files) is only downloaded, never opened inline here.
 */
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'application/pdf']);

export function opensInline(type: string): boolean {
  return INLINE_TYPES.has(type);
}

/** An image's measures and fingerprints: what a mark is saved as (never the image). */
export interface ImagePrint {
  width: number;
  height: number;
  /** sha256 of the bytes: the same file. */
  exact: string;
  /** 64-bit difference hash, 16 hex digits: the same picture, resized or re-encoded. */
  dhash: string;
  /** width / height */
  ratio: number;
}

/** The print of an image, or null when it cannot be decoded. */
export async function printOf(data: Buffer): Promise<ImagePrint | null> {
  try {
    const image = sharp(data, { failOn: 'none', animated: false });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return null;
    const pixels = await sharp(data, { failOn: 'none', animated: false }).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    let bits = 0n;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        bits = (bits << 1n) | ((pixels[row * 9 + col] ?? 0) > (pixels[row * 9 + col + 1] ?? 0) ? 1n : 0n);
      }
    }
    return {
      width: meta.width,
      height: meta.height,
      exact: createHash('sha256').update(data).digest('hex'),
      dhash: bits.toString(16).padStart(16, '0'),
      ratio: meta.width / meta.height,
    };
  } catch {
    return null;
  }
}

/**
 * The rule for a signature image, before any mark (cerini-ia's): small (< 100 KB), not tall
 * (≤ 150 px) and wide, or an icon (≤ 48 px each way: the social icons under a signature).
 */
export function looksLikeLogo(size: number, print: Pick<ImagePrint, 'width' | 'height'>): boolean {
  const icon = print.width <= 48 && print.height <= 48;
  const banner = size < 100_000 && print.height <= 150 && print.width >= 1.5 * print.height;
  return icon || banner;
}

export type Mark = 'logo' | 'photo';

export interface SavedMark {
  exact: string;
  dhash: string;
  ratio: number;
  mark: Mark;
}

function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** The user's mark for an image: the same file, or the same picture (≤ 6 bits apart, a similar shape). */
export function markFor(print: ImagePrint, marks: readonly SavedMark[]): Mark | null {
  const same = marks.find((m) => m.exact === print.exact);
  if (same) return same.mark;
  const near = marks
    .filter((m) => Math.abs(m.ratio - print.ratio) <= 0.1 * Math.max(m.ratio, print.ratio))
    .map((m) => ({ m, distance: hamming(m.dhash, print.dhash) }))
    .filter((x) => x.distance <= 6)
    .sort((a, b) => a.distance - b.distance)[0];
  return near?.m.mark ?? null;
}
