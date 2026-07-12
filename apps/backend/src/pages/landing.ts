/**
 * Public marketing page, served at GET /. Self-contained (no build step,
 * no external assets) — same "one file, inline everything" approach as the
 * billing success/cancel pages, just bigger. Reuses the extension's own
 * brand tokens (apps/extension/public/theme.css) and logo mark (ADR-24) so
 * the web presence and the product read as the same thing, not a separate
 * marketing skin.
 */
export const LANDING_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MailTrack — verified email tracking for Gmail</title>
<meta name="description" content="MailTrack tells you when an email is actually read — never a fake 'read' from an automated pixel fetch, notification preview, or security scanner." />
<style>
  :root {
    --brand: #1a73e8; --brand-ink: #1557b0; --green: #188038; --amber: #b7791f; --red: #d93025;
    --ink: #202124; --ink-soft: #5f6368; --ink-faint: #80868b; --border: #e4e7ea; --border-soft: #eef0f2;
    --bg: #ffffff; --bg-soft: #f7f9fb; --bg-raised: #ffffff; --brand-tint: #1a73e814;
    --shadow-sm: 0 1px 2px rgba(32,33,36,0.06); --shadow-md: 0 4px 16px rgba(32,33,36,0.1);
    --radius: 14px; --radius-sm: 8px;
    --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --brand: #6ba5f0; --brand-ink: #8ab8f4; --green: #57b96f; --amber: #d9a441; --red: #ef6d5e;
      --ink: #e8eaed; --ink-soft: #9aa0a6; --ink-faint: #6c7176; --border: #303338; --border-soft: #26282c;
      --bg: #17181a; --bg-soft: #1e2023; --bg-raised: #212326; --brand-tint: #6ba5f022;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.35); --shadow-md: 0 6px 24px rgba(0,0,0,0.45);
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--font); color: var(--ink); background: var(--bg); -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 0 1.5rem; }

  header { padding: 1.4rem 0; border-bottom: 1px solid var(--border-soft); }
  header .wrap { display: flex; align-items: center; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 0.6rem; text-decoration: none; }
  .brand .logo { width: 30px; height: 30px; flex-shrink: 0; }
  .brand .wordmark { font-size: 1.1rem; font-weight: 700; letter-spacing: -0.01em; }
  .brand .wordmark span { color: var(--brand); }
  .nav-cta { font-size: 0.85rem; font-weight: 600; padding: 0.5rem 1rem; border-radius: 999px; background: var(--brand); color: #fff; text-decoration: none; }
  .nav-cta:hover { background: var(--brand-ink); }

  .hero { padding: 5rem 0 4rem; text-align: center; }
  .hero h1 { font-size: clamp(2rem, 5vw, 3rem); line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 1.1rem; font-weight: 800; }
  .hero h1 .accent { color: var(--brand); }
  .hero p.sub { font-size: 1.15rem; color: var(--ink-soft); max-width: 600px; margin: 0 auto 2.2rem; line-height: 1.55; }
  .hero-ctas { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.95rem; font-weight: 600; padding: 0.8rem 1.5rem; border-radius: 999px; text-decoration: none; border: 1px solid transparent; }
  .btn-primary { background: var(--brand); color: #fff; }
  .btn-primary:hover { background: var(--brand-ink); }
  .btn-ghost { background: transparent; border-color: var(--border); color: var(--ink); }
  .btn-ghost:hover { background: var(--bg-soft); }

  .badges-row { display: flex; gap: 0.6rem; justify-content: center; margin-top: 2.5rem; flex-wrap: wrap; }
  .mini-badge { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; font-weight: 600; padding: 0.35rem 0.8rem; border-radius: 999px; }
  .mini-badge .dot { width: 7px; height: 7px; border-radius: 50%; }
  .mb-blue { color: var(--brand); background: var(--brand-tint); } .mb-blue .dot { background: var(--brand); }
  .mb-green { color: var(--green); background: color-mix(in srgb, var(--green) 15%, transparent); } .mb-green .dot { background: var(--green); }
  .mb-red { color: var(--red); background: color-mix(in srgb, var(--red) 15%, transparent); } .mb-red .dot { background: var(--red); }

  section { padding: 3.5rem 0; }
  section.alt { background: var(--bg-soft); border-top: 1px solid var(--border-soft); border-bottom: 1px solid var(--border-soft); }
  h2 { font-size: 1.7rem; letter-spacing: -0.01em; margin: 0 0 0.6rem; text-align: center; }
  p.section-sub { color: var(--ink-soft); text-align: center; max-width: 620px; margin: 0 auto 2.5rem; line-height: 1.55; }

  .honesty-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
  .honesty-card { background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.3rem; }
  .honesty-card h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
  .honesty-card p { margin: 0; font-size: 0.87rem; color: var(--ink-soft); line-height: 1.5; }
  .honesty-card.no { border-color: color-mix(in srgb, var(--red) 30%, var(--border)); }
  .honesty-card.yes { border-color: color-mix(in srgb, var(--green) 30%, var(--border)); }

  .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; }
  .feature { padding: 0.5rem; }
  .feature .icon { width: 40px; height: 40px; border-radius: 10px; background: var(--brand-tint); color: var(--brand); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; margin-bottom: 0.85rem; }
  .feature h3 { margin: 0 0 0.4rem; font-size: 1rem; }
  .feature p { margin: 0; font-size: 0.87rem; color: var(--ink-soft); line-height: 1.5; }

  .pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.25rem; max-width: 680px; margin: 0 auto; }
  .price-card { background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.75rem; text-align: center; box-shadow: var(--shadow-sm); }
  .price-card.featured { border-color: var(--brand); box-shadow: var(--shadow-md); position: relative; }
  .price-card .tag { position: absolute; top: -0.65rem; left: 50%; transform: translateX(-50%); background: var(--brand); color: #fff; font-size: 0.72rem; font-weight: 700; padding: 0.25rem 0.7rem; border-radius: 999px; }
  .price-card h3 { margin: 0 0 0.3rem; font-size: 1rem; color: var(--ink-soft); font-weight: 600; }
  .price-card .amount { font-size: 2.4rem; font-weight: 800; letter-spacing: -0.02em; margin: 0.3rem 0; }
  .price-card .amount span { font-size: 1rem; font-weight: 500; color: var(--ink-soft); }
  .price-card .note { font-size: 0.82rem; color: var(--ink-soft); margin-bottom: 1.4rem; }
  .price-card .btn { width: 100%; justify-content: center; }
  .price-hint { text-align: center; font-size: 0.82rem; color: var(--ink-faint); margin-top: 1.25rem; }

  footer { padding: 2.5rem 0; border-top: 1px solid var(--border-soft); text-align: center; font-size: 0.82rem; color: var(--ink-faint); }
  footer a { color: var(--brand); text-decoration: none; }
</style>
</head>
<body>

<header>
  <div class="wrap">
    <a class="brand" href="/">
      <svg class="logo" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a73e8"/><stop offset="1" stop-color="#1557b0"/></linearGradient></defs>
        <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#bg)"/>
        <rect x="24" y="40" width="80" height="52" rx="9" fill="#ffffff"/>
        <path d="M28 46 L64 72 L100 46" fill="none" stroke="#1a73e8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="95" cy="89" r="24" fill="#188038" stroke="#ffffff" stroke-width="7"/>
        <path d="M84 89 L92 97 L107 81" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="wordmark">Mail<span>Track</span></span>
    </a>
    <a class="nav-cta" href="#get-started">Get early access</a>
  </div>
</header>

<div class="hero">
  <div class="wrap">
    <h1>Know when your email is<br/>actually <span class="accent">read.</span></h1>
    <p class="sub">Most Gmail trackers report "read" the instant a tracking pixel is fetched — even when it's just Apple's privacy protection, a phone notification preview, or a security scanner. MailTrack tells you the truth instead.</p>
    <div class="hero-ctas">
      <a class="btn btn-primary" href="#get-started">Get early access</a>
      <a class="btn btn-ghost" href="#how-it-works">See how it works</a>
    </div>
    <div class="badges-row">
      <span class="mini-badge mb-green"><span class="dot"></span>Read</span>
      <span class="mini-badge mb-blue"><span class="dot"></span>Likely read</span>
      <span class="mini-badge mb-red"><span class="dot"></span>Not verifiable</span>
    </div>
  </div>
</div>

<section class="alt">
  <div class="wrap">
    <h2>Every other tracker lies to you at least a little</h2>
    <p class="section-sub">A tracking pixel gets fetched constantly by things that aren't a human reading your email. MailTrack is built around one rule: never report a "read" it can't actually back up.</p>
    <div class="honesty-grid">
      <div class="honesty-card no">
        <h3>❌ Typical email trackers</h3>
        <p>Mark it "read" the moment any request touches the pixel — even Apple Mail Privacy Protection's automatic prefetch, a phone's notification preview, or a corporate security scanner pre-scanning the email. You get false confidence, not real signal.</p>
      </div>
      <div class="honesty-card yes">
        <h3>✅ MailTrack</h3>
        <p>Classifies every single fetch — timing, browser signature, network origin, repeat pattern — before it counts as anything. If it can't verify a human read it, it says "Not verifiable" instead of guessing. Honesty is the entire product.</p>
      </div>
    </div>
  </div>
</section>

<section id="how-it-works">
  <div class="wrap">
    <h2>How it works</h2>
    <p class="section-sub">Nothing to configure per email — it works quietly in the background every time you send from Gmail.</p>
    <div class="features">
      <div class="feature">
        <div class="icon">1</div>
        <h3>Send normally</h3>
        <p>Compose and send from Gmail like always. MailTrack invisibly tags the message — no visible change to what you send.</p>
      </div>
      <div class="feature">
        <div class="icon">2</div>
        <h3>We classify every signal</h3>
        <p>Every open, click, and reply is checked against timing, user-agent, and network signals before it's trusted.</p>
      </div>
      <div class="feature">
        <div class="icon">3</div>
        <h3>You get the real answer</h3>
        <p>A live dashboard, desktop notifications, and a Gmail status chip show exactly what's verified — and what isn't.</p>
      </div>
    </div>
  </div>
</section>

<section class="alt">
  <div class="wrap">
    <h2>Everything you'd expect, done honestly</h2>
    <div class="features" style="margin-top:2rem">
      <div class="feature"><div class="icon">✓</div><h3>Verified opens</h3><p>Only counted once a fetch passes every automated-prefetch check.</p></div>
      <div class="feature"><div class="icon">🔗</div><h3>Per-link click detail</h3><p>See exactly which link was clicked, not just that one was.</p></div>
      <div class="feature"><div class="icon">↩</div><h3>Reply detection</h3><p>The one signal no automated system can fake — a human has to write it.</p></div>
      <div class="feature"><div class="icon">⚠</div><h3>Bounce detection</h3><p>Know when an email never actually arrived, not just that it was never opened.</p></div>
      <div class="feature"><div class="icon">⏰</div><h3>Follow-up reminders</h3><p>A gentle nudge when something's gone unopened or unanswered for days.</p></div>
      <div class="feature"><div class="icon">🔔</div><h3>Real-time notifications</h3><p>Desktop alerts that name the recipient and subject, not just "something happened."</p></div>
    </div>
  </div>
</section>

<section id="get-started">
  <div class="wrap">
    <h2>Simple pricing</h2>
    <p class="section-sub">One plan, everything included. Cancel any time.</p>
    <div class="pricing-grid">
      <div class="price-card">
        <h3>Monthly</h3>
        <div class="amount">$4.99<span>/mo</span></div>
        <div class="note">Billed monthly</div>
        <a class="btn btn-ghost" href="mailto:studio@lensr.in?subject=MailTrack%20early%20access">Request access</a>
      </div>
      <div class="price-card featured">
        <span class="tag">Best value</span>
        <h3>Yearly</h3>
        <div class="amount">$49<span>/yr</span></div>
        <div class="note">≈ $4.08/mo — 2 months free</div>
        <a class="btn btn-primary" href="mailto:studio@lensr.in?subject=MailTrack%20early%20access">Request access</a>
      </div>
    </div>
    <p class="price-hint">MailTrack is currently in private early access, ahead of a full Chrome Web Store launch. Request access and we'll get you set up directly.</p>
  </div>
</section>

<footer>
  <div class="wrap">
    MailTrack — verified email tracking for Gmail. Questions? <a href="mailto:studio@lensr.in">studio@lensr.in</a>
  </div>
</footer>

</body>
</html>`;
