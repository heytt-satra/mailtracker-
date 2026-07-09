// InboxSDK ships its "page world" bridge script (the file its own
// background.js message listener injects into Gmail's page via
// chrome.scripting.executeScript({world: 'MAIN', files: ['pageWorld.js']}))
// as a pre-built, self-contained bundle directly inside the npm package —
// see PLAN.md ADR-12. It needs to land at the extension's build root as
// exactly "pageWorld.js", which WXT's public/ directory does verbatim.
// Copied from node_modules at build time (not committed to git, not copied
// by hand) so it always matches whatever @inboxsdk/core version is
// actually installed. Resolved via require.resolve (not a hardcoded
// relative path) since npm workspaces hoists @inboxsdk/core to the
// monorepo root, not apps/extension/node_modules.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = require.resolve('@inboxsdk/core/pageWorld.js');
const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const destDir = join(extensionRoot, 'public');
const dest = join(destDir, 'pageWorld.js');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`Copied InboxSDK pageWorld.js -> ${dest}`);
