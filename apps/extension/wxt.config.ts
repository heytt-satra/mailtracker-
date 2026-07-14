import { defineConfig } from 'wxt';

// mailtrack-api.heyttsatra17.workers.dev is the real deployed backend
// (2026-07-08, Cloudflare workers.dev subdomain — no custom domain
// purchased yet). Update MAILTRACK_API_BASE_URL here and in src/config.ts
// together if this ever moves to a custom domain.
export default defineConfig({
  manifest: {
    name: 'MailTrack',
    description: 'Gmail email tracking that reports verified opens, not every pixel fetch.',
    // ADR-47. Fixes the extension's chrome-extension://<id> permanently,
    // BEFORE Chrome Web Store publishing — without this, the id is derived
    // from install path for an unpacked/dev load and only becomes stable
    // once first uploaded to the Store, meaning the backend's CORS lockdown
    // (ALLOWED_EXTENSION_ORIGIN, apps/backend/wrangler.toml) couldn't be
    // set to anything but a wildcard until after publishing. This is the
    // base64 DER-encoded PUBLIC half of an RSA keypair generated once
    // (.secrets/extension-key.pem, gitignored, never committed) — safe to
    // commit; Chrome derives the extension id purely from this public key,
    // same id whether loaded unpacked, sideloaded, or uploaded to the Store
    // with this same key. Corresponding id:
    // kjgiejkgmfcnndldnlbmggabddhgdlee
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkCEVQvIibtSH/rKbcDYaleDl+GsTB1/JOQTBYck+bOmSfVjIfmRe1bZNK6FbltL+kqY+UJulRTuH4bLYsVG5lERoMRg10ljcPbTsBLWAp6ptIF/FDi3sh/Ncj+cToRc3cJxIqoIZg0VBHTg6aSyogkDrMvCzx5uwrZYhMs7XP+ooXTgoClzaaIcOmspKDHVKVjlEmOZsHs0OrwzQpZ/53JKvgDqmuklZktbTQW4sAT21HxLE+7KJOAtEXrrPkMEPkmbWety0tJ2Cn5Qjr2KAX39nUOvtVuMUSPUfI1AeXSgG2AaLBmoSXGvre3SzNOH51V90/G+GfsoFkEPY3aN5twIDAQAB',
    // 'scripting' is required by @inboxsdk/core, not used directly by our
    // own code: InboxSDK injects a "page world" bridge script into Gmail's
    // actual page context (content scripts run in an isolated world and
    // can't reach Gmail's own JS state otherwise) via
    // chrome.scripting.executeScript({world: 'MAIN', ...}), which needs this
    // permission declared or it fails with "Couldn't inject pageWorld.js" —
    // found live, post-deployment, via a real user's Gmail console errors;
    // verified against InboxSDK's own reference manifest before adding.
    permissions: ['storage', 'notifications', 'alarms', 'scripting'],
    // *.supabase.co covers Supabase's standard hosted project domain (the
    // options page's signup/login calls Supabase Auth directly, ADR-10). A
    // self-hosted Supabase instance would need its own origin added here.
    host_permissions: [
      'https://mail.google.com/*',
      'https://mailtrack-api.heyttsatra17.workers.dev/*',
      'http://localhost:8787/*',
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
});
