import { defineConfig } from 'wxt';

// mailtrack-api.heyttsatra17.workers.dev is the real deployed backend
// (2026-07-08, Cloudflare workers.dev subdomain — no custom domain
// purchased yet). Update MAILTRACK_API_BASE_URL here and in src/config.ts
// together if this ever moves to a custom domain.
export default defineConfig({
  manifest: {
    name: 'MailTrack',
    description: 'Gmail email tracking that reports verified opens, not every pixel fetch.',
    permissions: ['storage', 'notifications', 'alarms'],
    // *.supabase.co covers Supabase's standard hosted project domain (the
    // options page's signup/login calls Supabase Auth directly, ADR-10). A
    // self-hosted Supabase instance would need its own origin added here.
    host_permissions: [
      'https://mail.google.com/*',
      'https://mailtrack-api.heyttsatra17.workers.dev/*',
      'http://localhost:8787/*',
      'https://*.supabase.co/*',
    ],
    // Placeholder 1x1 PNGs (see PLAN.md Known Issues) — real branding/icon
    // design is deferred to M7; these exist only so the manifest is valid
    // and notifications have an iconUrl that resolves.
    icons: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' },
  },
});
