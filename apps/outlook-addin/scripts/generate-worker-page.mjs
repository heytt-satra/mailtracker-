// ADR-61 (Outlook add-in, C2). Generates apps/backend/src/pages/outlook-addin.ts
// from this workspace's Vite build output (dist/) plus manifest.xml — the
// backend Worker has no filesystem/static-asset serving of its own, so the
// built HTML/JS/PNG content gets embedded as string constants, the same
// "one file, inline everything" pattern already used for landing.ts/privacy.ts
// (text) and beacon.ts's PIXEL_GIF_BASE64 (binary, base64). Run after
// `npm run build` in this workspace: node scripts/generate-worker-page.mjs
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, 'dist');
const backendPagesDir = join(root, '..', 'backend', 'src', 'pages');

function readText(path) {
  return readFileSync(path, 'utf8');
}

function readBase64(path) {
  return readFileSync(path).toString('base64');
}

const taskpaneHtml = readText(join(distDir, 'taskpane.html'));
const functionsHtml = readText(join(distDir, 'functions.html'));
const manifestXml = readText(join(root, 'manifest.xml'));

// Every file under dist/assets (JS, always text) plus every icon-*.png Vite
// copied from public/ into the dist root (binary, base64-encoded).
const assets = {};

for (const file of readdirSync(join(distDir, 'assets'))) {
  assets[`assets/${file}`] = { contentType: 'application/javascript; charset=utf-8', encoding: 'utf8', content: readText(join(distDir, 'assets', file)) };
}

for (const file of readdirSync(distDir)) {
  if (extname(file) === '.png') {
    assets[file] = { contentType: 'image/png', encoding: 'base64', content: readBase64(join(distDir, file)) };
  }
}

function jsStringLiteral(value) {
  return JSON.stringify(value);
}

const output = `/**
 * GENERATED FILE — do not hand-edit. Regenerate with:
 *   cd apps/outlook-addin && npm run build && node scripts/generate-worker-page.mjs
 *
 * ADR-61 (Outlook add-in, C2). Embeds this workspace's Vite build output
 * (task pane, function-file, JS bundles, icons) plus manifest.xml as string
 * constants, served by apps/backend/src/index.ts under /outlook/*. Same
 * origin as the API itself, so /v1/* calls from either page are same-origin
 * (no CORS config needed for this client).
 */

export const OUTLOOK_TASKPANE_HTML = ${jsStringLiteral(taskpaneHtml)};

export const OUTLOOK_FUNCTIONS_HTML = ${jsStringLiteral(functionsHtml)};

export const OUTLOOK_MANIFEST_XML = ${jsStringLiteral(manifestXml)};

export interface OutlookAsset {
  contentType: string;
  encoding: 'utf8' | 'base64';
  content: string;
}

export const OUTLOOK_ASSETS: Record<string, OutlookAsset> = ${JSON.stringify(assets, null, 2)};
`;

writeFileSync(join(backendPagesDir, 'outlook-addin.ts'), output);
console.log(`Wrote ${join(backendPagesDir, 'outlook-addin.ts')} (${Object.keys(assets).length} embedded assets)`);
