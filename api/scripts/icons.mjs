// Makes the desktop app's icons from assets/icon.svg (run again after changing it):
//   node scripts/icons.mjs
// icon.png (512 px): the installer, the window, the notifications; tray.png / tray@2x.png: the tray.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const svg = await readFile(`${assets}icon.svg`);

for (const [name, size] of [
  ['icon.png', 512],
  ['tray.png', 16],
  ['tray@2x.png', 32],
]) {
  await sharp(svg, { density: Math.max(72, (72 * size) / 256) })
    .resize(size, size)
    .png()
    .toFile(`${assets}${name}`);
  console.log(`assets/${name} (${size} px)`);
}
