import { defineConfig } from 'wxt';

// mailtrack-api.heyttsatra17.workers.dev is the real deployed backend
// (2026-07-08, Cloudflare workers.dev subdomain — no custom domain
// purchased yet). Update MAILTRACK_API_BASE_URL here and in src/config.ts
// together if this ever moves to a custom domain.
export default defineConfig({
  manifest: {
    name: 'MailTrack',
    description: 'Gmail email tracking that reports verified opens, not every pixel fetch.',
    // ADR-47/53. The fixed manifest `key` from ADR-47 turned out to be
    // unusable: the Chrome Web Store rejects any upload whose manifest
    // contains a `key` field ("key field is not allowed in manifest") —
    // that field only pins the id for local unpacked/sideloaded installs,
    // not Store uploads. The Store assigns its own id on first publish
    // (by design, to prevent id squatting), so ADR-47's premise doesn't
    // hold for this path. The real, permanent id will only be known once
    // this is actually published — update ALLOWED_EXTENSION_ORIGIN in
    // apps/backend/wrangler.toml with that real id then, not before.
    // .secrets/extension-key.pem (never committed) is now unused.
    // 'scripting' is required by @inboxsdk/core, not used directly by our
    // own code: InboxSDK injects a "page world" bridge script into Gmail's
    // actual page context (content scripts run in an isolated world and
    // can't reach Gmail's own JS state otherwise) via
    // chrome.scripting.executeScript({world: 'MAIN', ...}), which needs this
    // permission declared or it fails with "Couldn't inject pageWorld.js" —
    // found live, post-deployment, via a real user's Gmail console errors;
    // verified against InboxSDK's own reference manifest before adding.
    // 'identity' backs Google sign-in (ADR-56, src/auth.ts::signInWithGoogle)
    // via chrome.identity.launchWebAuthFlow — the extension-platform
    // equivalent of a normal web redirect-based OAuth flow, which doesn't
    // otherwise exist for an MV3 extension with no page of its own to
    // redirect.
    permissions: ['storage', 'notifications', 'alarms', 'scripting', 'identity'],
    // *.supabase.co covers Supabase's standard hosted project domain (the
    // options page's signup/login calls Supabase Auth directly, ADR-10). A
    // self-hosted Supabase instance would need its own origin added here.
    //
    // ADR-54. localhost:8787 (the local dev backend) is only included
    // outside production builds — `wxt build`/`wxt zip` set NODE_ENV to
    // "production" (see registerWxt in wxt's own source), which is exactly
    // the artifact uploaded to the Chrome Web Store. Shipping a permission
    // real users have no use for is an unjustifiable ask that only invites
    // extra reviewer scrutiny on an already Gmail-host-permission-flagged
    // submission, for zero benefit — `npm run dev` still gets it.
    host_permissions: [
      'https://mail.google.com/*',
      'https://mailtrack-api.heyttsatra17.workers.dev/*',
      ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:8787/*']),
      'https://*.supabase.co/*',
    ],
    // Real branded icons (ADR-24), rendered from assets/logo.svg via
    // scripts/render-icons.mjs — an envelope + verification check in the
    // product's own status colors. Replaced the original 1x1 placeholders.
    icons: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' },
    // Clicking the toolbar icon opens the popup — the product's new front
    // door (ADR-24). Previously the icon opened nothing and the only way in
    // was right-click > Options > "Open dashboard", a three-step detour.
    action: { default_popup: 'popup.html', default_title: 'MailTrack' },
  },
  // ADR-55. Chrome Web Store rejected the MV3 submission ("remotely-hosted
  // code") over a string it found in the bundled dashboard chunk:
  // https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js
  // That URL is jsPDF's OWN internal `output('pdfobjectnewwindow', ...)`
  // branch (node_modules/jspdf/dist/jspdf.es.min.js) — a feature that, if
  // invoked, dynamically injects a <script src="..."> tag to lazy-load the
  // PDFObject viewer library from a CDN. Our own code (report-pdf.ts) only
  // ever calls `.save()` (a local browser download) — this branch is dead
  // code we never reach — but Chrome's scanner flags the string's mere
  // presence in the bundle, not reachability. This plugin strips that one
  // case out of jsPDF's source at build time (replacing it with a throw,
  // since it's unreachable for us anyway), which is the only way to remove
  // the offending string without forking or replacing the whole library.
  vite: () => ({
    plugins: [
      {
        name: 'strip-jspdf-remote-pdfobject-branch',
        transform(code, id) {
          if (!id.includes('jspdf') || !code.includes('pdfobjectnewwindow')) return null;
          const stripped = code.replace(
            /case"pdfobjectnewwindow":[\s\S]*?(?=case"pdfjsnewwindow":)/,
            'case"pdfobjectnewwindow":throw new Error("pdfobjectnewwindow output type is disabled in this build");',
          );
          if (stripped === code) {
            throw new Error(
              'strip-jspdf-remote-pdfobject-branch: expected pattern not found in ' + id + ' — jsPDF version likely changed shape; update the regex before shipping, or the remote-code string will ship again.',
            );
          }
          return { code: stripped, map: null };
        },
      },
    ],
  }),
});
