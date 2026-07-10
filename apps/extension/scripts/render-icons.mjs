// Renders assets/logo.svg to the PNG icon sizes Chrome MV3 requires
// (ADR-24 — replaces the 1x1 placeholder PNGs from the original scaffold).
// Run manually after changing the logo: node scripts/render-icons.mjs
// Not wired into the build (unlike copy-pageworld.mjs) because the logo
// changes rarely and sharp is a heavy native dep to invoke on every build;
// the generated PNGs are committed instead.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { copyFileSync } from 'node:fs';
import sharp from 'sharp';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const svgPath = join(root, 'assets', 'logo.svg');

for (const size of [16, 32, 48, 128]) {
  const out = join(root, 'public', `icon-${size}.png`);
  await sharp(svgPath, { density: 300 }).resize(size, size).png().toFile(out);
  console.log(`rendered ${out}`);
}

// Also ship the SVG itself so the popup/options/dashboard headers can use it.
copyFileSync(svgPath, join(root, 'public', 'logo.svg'));
console.log('copied logo.svg to public/');
