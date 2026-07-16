/**
 * Public privacy policy, served at GET /privacy — required by the Chrome
 * Web Store before the extension can publish (any item that collects user
 * data must link a live privacy policy URL). Same "one file, inline
 * everything" approach as landing.ts.
 */
export const PRIVACY_POLICY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MailTrack — Privacy Policy</title>
<style>
  :root {
    --ink: #202124; --ink-soft: #5f6368; --border: #e4e7ea; --bg: #ffffff;
    --brand: #1a73e8; --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #e8eaed; --ink-soft: #9aa0a6; --border: #303338; --bg: #17181a; --brand: #6ba5f0; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--font); color: var(--ink); background: var(--bg); -webkit-font-smoothing: antialiased; line-height: 1.6; }
  a { color: var(--brand); }
  .wrap { max-width: 760px; margin: 0 auto; padding: 3rem 1.5rem 5rem; }
  h1 { font-size: 1.7rem; margin-bottom: 0.25rem; }
  .updated { color: var(--ink-soft); font-size: 0.9rem; margin-bottom: 2.5rem; }
  h2 { font-size: 1.15rem; margin-top: 2.25rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
  ul { padding-left: 1.3rem; }
  li { margin: 0.35rem 0; }
  p { margin: 0.9rem 0; }
</style>
</head>
<body>
<div class="wrap">
  <h1>MailTrack Privacy Policy</h1>
  <p class="updated">Last updated: July 16, 2026</p>

  <p>MailTrack ("we", "us") is a Chrome extension that tells you when an email you sent from Gmail was actually opened, clicked, replied to, or bounced. This page explains what data we collect, why, and how you can control it.</p>

  <h2>What we collect</h2>
  <ul>
    <li><strong>Your account email and password</strong> — used to create and authenticate your MailTrack account (handled via Supabase Auth). Passwords are never stored by us in plaintext.</li>
    <li><strong>Metadata about emails you choose to track</strong> — the recipient's email address, the subject line, and the link URLs contained in the email body. We do not read, store, or transmit the full body text of your emails.</li>
    <li><strong>Open, click, reply, and bounce events</strong> — when a tracked email is opened, we log signals used to verify the open is genuine (timing, IP address/ASN, user agent, repeat-fetch pattern). Raw IP addresses are hashed after classification and are not retained beyond 30 days.</li>
    <li><strong>Subscription/billing status</strong> — whether your account has an active subscription, handled through our payment processor (Dodo Payments). We do not receive or store your card details; those are handled entirely by the payment processor.</li>
  </ul>

  <h2>What we don't collect</h2>
  <ul>
    <li>We do not read or store the content/body of your emails.</li>
    <li>We do not track your general web browsing outside of Gmail.</li>
    <li>We do not monitor keystrokes, mouse movement, or scroll behavior.</li>
  </ul>

  <h2>How we use this data</h2>
  <p>Solely to provide the tracking feature itself: showing you whether, when, and with what confidence a sent email was opened, clicked, replied to, or bounced, inside the MailTrack dashboard and Gmail status chips.</p>

  <h2>Data sharing</h2>
  <p>We do not sell or rent your data to any third party. Data is processed by our infrastructure providers (Cloudflare, for hosting and delivery; Supabase, for authentication and database storage; Dodo Payments, for billing) solely to operate the service on our behalf.</p>

  <h2>Data retention and deletion</h2>
  <p>Raw IP addresses used for open verification are hashed after classification and deleted within 30 days. You can delete tracking data for any sent message from the MailTrack dashboard. You can delete your entire account and all associated data by contacting us at the address below.</p>

  <h2>Contact</h2>
  <p>Questions about this policy or your data: <a href="mailto:studio@lensr.in">studio@lensr.in</a></p>
</div>
</body>
</html>`;
