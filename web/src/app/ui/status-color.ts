/**
 * The colour of a ticket's status (lenzi, 2026-11-03: "use different colors for ticket statuses
 * much like substance tracker generates the color for substances"): substance-tracker's identity
 * colour (its ui/identity-color-pipe.ts), computed from the status's place in the CRM's list of
 * statuses, never stored. The same violet band as the theme; the hue walks the band by the golden
 * ratio, so neighbouring statuses land far apart; one of three lightnesses by `n % 3`; the most
 * chroma the screen can show, up to 0.22. A status the CRM does not list (-1) gets the outline grey.
 * FROZEN as in substance-tracker: changing it repaints every status.
 */

const GOLDEN_RATIO = 0.6180339887;
const HUE_FROM = 260;
const HUE_SPAN = 80;
const LIGHTNESS = [0.88, 0.74, 0.6] as const;
const MAX_CHROMA = 0.22;

/** The background of a status's chip, an `oklch()`; its text is dark on every one of them. */
export function statusColor(index: number): string {
  if (!Number.isInteger(index) || index < 0) return 'var(--mat-sys-surface-container-highest)';
  // Ids in substance-tracker start at 1: the first status is 1 here too.
  const n = index + 1;
  const position = (n * GOLDEN_RATIO) % 1;
  const hue = HUE_FROM + position * HUE_SPAN;
  const lightness = LIGHTNESS[n % 3] as number;
  const chroma = maxChroma(lightness, hue);
  return `oklch(${lightness} ${chroma} ${Number(hue.toFixed(1))})`;
}

/** The most chroma, up to MAX_CHROMA, that keeps the colour inside sRGB (bisection, to a thousandth). */
function maxChroma(lightness: number, hue: number): number {
  if (inSrgb(lightness, MAX_CHROMA, hue)) return MAX_CHROMA;
  let low = 0;
  let high = MAX_CHROMA;
  while (high - low > 0.0005) {
    const middle = (low + high) / 2;
    if (inSrgb(lightness, middle, hue)) low = middle;
    else high = middle;
  }
  return Math.floor(low * 1000) / 1000;
}

/** Whether an oklch colour is one sRGB can show (OKLab to linear sRGB, Björn Ottosson's matrices). */
function inSrgb(lightness: number, chroma: number, hue: number): boolean {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.every((channel) => channel >= -1e-6 && channel <= 1 + 1e-6);
}
