import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// package.json has "type": "module", so __dirname isn't a global here.
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * ADR-61 (Outlook add-in, C2). Two independent HTML entry points — the
 * task pane (sign-in UI, a real user-visible surface) and the function
 * file (the on-send handler, no UI) — built as a standard Vite
 * multi-page app. Output is served by the backend Worker under /outlook/*
 * (apps/backend/src/pages/outlook-addin.ts), the same origin as the API
 * itself, so /v1/* calls from either page are same-origin (no CORS
 * config needed for this client — see PLAN.md).
 */
export default defineConfig({
  // Served by the backend Worker under /outlook/* (see the scripts/
  // generate-worker-page.mjs codegen step) — base must match that mount
  // point so the built HTML's own <script>/asset references resolve.
  base: '/outlook/',
  build: {
    rollupOptions: {
      input: {
        taskpane: resolve(__dirname, 'taskpane.html'),
        functions: resolve(__dirname, 'functions.html'),
      },
    },
  },
});
