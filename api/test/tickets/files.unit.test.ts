import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { looksLikeLogo, markFor, opensInline, printOf, sniffType } from '../../src/modules/tickets/files.js';

/** A test image: a left-to-right gradient, or its mirror. */
async function gradient(width: number, height: number, mirror = false, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round(((mirror ? width - 1 - x : x) / (width - 1)) * 255);
      raw.fill(v, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  const image = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: 80 }).toBuffer();
}

describe('sniffType', () => {
  it('reads the type from the bytes, not from the name', async () => {
    expect(sniffType(await gradient(4, 4), 'invoice.pdf')).toBe('image/png');
    expect(sniffType(Buffer.from('%PDF-1.7 ...'), 'x.xlsx')).toBe('application/pdf');
    expect(sniffType(Buffer.from('504b030414000000', 'hex'), 'report.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(sniffType(Buffer.from('504b030414000000', 'hex'), 'files.zip')).toBe('application/zip');
    expect(sniffType(Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'old.doc')).toBe('application/msword');
    expect(sniffType(Buffer.from('<html><script>alert(1)</script>'), 'page.png')).toBe('application/octet-stream');
    expect(sniffType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'logo.svg')).toBe('application/octet-stream');
  });

  it('only images and PDFs open inline; HTML, SVG and the rest are downloaded', () => {
    expect(opensInline('image/png')).toBe(true);
    expect(opensInline('application/pdf')).toBe(true);
    for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', 'application/zip']) expect(opensInline(type)).toBe(false);
  });
});

describe('image prints and marks', () => {
  it('measures an image and fingerprints it; not an image: null', async () => {
    const print = await printOf(await gradient(300, 100));
    expect(print).toMatchObject({ width: 300, height: 100, ratio: 3 });
    expect(print?.exact).toMatch(/^[0-9a-f]{64}$/);
    expect(print?.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(await printOf(Buffer.from('not an image'))).toBeNull();
  });

  it('the logo rule: a small wide banner, or an icon; not a photo', () => {
    expect(looksLikeLogo(20_000, { width: 300, height: 100 })).toBe(true);
    expect(looksLikeLogo(3_000, { width: 32, height: 32 })).toBe(true);
    expect(looksLikeLogo(900_000, { width: 4000, height: 3000 })).toBe(false);
    expect(looksLikeLogo(20_000, { width: 120, height: 120 })).toBe(false);
  });

  it('a mark follows the same file, and the same picture re-encoded or resized; not another picture', async () => {
    const logo = (await printOf(await gradient(300, 100)))!;
    const marks = [{ exact: logo.exact, dhash: logo.dhash, ratio: logo.ratio, mark: 'logo' as const }];
    expect(markFor(logo, marks)).toBe('logo');
    const resized = (await printOf(await gradient(150, 50, false, 'jpeg')))!;
    expect(resized.exact).not.toBe(logo.exact);
    expect(markFor(resized, marks)).toBe('logo');
    const other = (await printOf(await gradient(300, 100, true)))!;
    expect(markFor(other, marks)).toBeNull();
    const otherShape = (await printOf(await gradient(100, 100)))!;
    expect(markFor(otherShape, marks)).toBeNull();
  });
});
