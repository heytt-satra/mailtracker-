/**
 * ADR-49. Landing page for Supabase's password-recovery email link — same
 * reasoning as auth/confirmed (routes/auth.ts): MailTrack has no regular
 * website, so without a real page here Supabase falls back to its
 * unconfigured default Site URL and the link goes nowhere.
 *
 * Unlike the confirmation page (which is purely informational — the action
 * already happened server-side), password reset genuinely needs to DO
 * something in the browser: Supabase's recovery link authenticates the
 * visitor via a token in the URL fragment, and only a client with the
 * Supabase JS SDK can turn that into a session and call
 * `auth.updateUser({password})`. That can't happen on the Worker itself
 * (no DOM/URL-fragment access server-side — URL fragments are never sent to
 * the server at all), so this page loads the Supabase JS SDK from a CDN and
 * completes the flow entirely in the visitor's browser. supabaseUrl/
 * supabaseAnonKey are the same public-safe values already embedded in the
 * extension itself (ADR-10) — safe to inline directly into HTML.
 */
export function buildResetPasswordHtml(supabaseUrl: string, supabaseAnonKey: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MailTrack — reset your password</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 380px; margin: 4rem auto; padding: 0 1.25rem; color: #202124; }
      h1 { font-size: 1.15rem; margin-bottom: 0.4rem; }
      p { color: #5f6368; font-size: 0.88rem; }
      label { display: block; font-size: 0.85rem; font-weight: 500; margin: 1rem 0 0.35rem; }
      input[type="password"] { width: 100%; box-sizing: border-box; padding: 0.55rem 0.65rem; border: 1px solid #dadce0; border-radius: 6px; font-size: 0.9rem; }
      button { width: 100%; margin-top: 1.25rem; padding: 0.6rem; border: none; border-radius: 6px; background: #1a73e8; color: #fff; font-size: 0.9rem; font-weight: 500; cursor: pointer; }
      button:disabled { opacity: 0.6; cursor: default; }
      #status { font-size: 0.85rem; margin-top: 0.85rem; min-height: 1.2em; }
      #status[data-error] { color: #d93025; }
      #status[data-ok] { color: #188038; }
      #form.hidden { display: none; }
    </style>
  </head>
  <body>
    <h1>Reset your password</h1>
    <p>Choose a new password for your MailTrack account.</p>

    <form id="form">
      <label for="newPassword">New password</label>
      <input type="password" id="newPassword" minlength="6" autocomplete="new-password" required />
      <label for="confirmPassword">Confirm new password</label>
      <input type="password" id="confirmPassword" minlength="6" autocomplete="new-password" required />
      <button type="submit" id="submitBtn">Set new password</button>
    </form>
    <div id="status" role="status" aria-live="polite">Verifying your reset link…</div>

    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script>
      const supabaseClient = window.supabase.createClient(${JSON.stringify(supabaseUrl)}, ${JSON.stringify(supabaseAnonKey)});
      const form = document.getElementById('form');
      const statusEl = document.getElementById('status');
      const submitBtn = document.getElementById('submitBtn');
      let recoverySessionReady = false;

      function setStatus(message, kind) {
        statusEl.textContent = message;
        statusEl.removeAttribute('data-error');
        statusEl.removeAttribute('data-ok');
        if (kind) statusEl.setAttribute('data-' + kind, '');
      }

      // Supabase's recovery link puts the session token in the URL fragment
      // and the client picks it up automatically on load (detectSessionInUrl
      // defaults to true), firing this event once a recovery session exists.
      supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
          recoverySessionReady = true;
          setStatus('', null);
        }
      });

      // If no recovery session shows up shortly, the link was likely already
      // used, expired, or opened directly (not via a real email link) —
      // say so rather than leaving the visitor staring at a live-looking
      // form that will only fail on submit.
      setTimeout(() => {
        if (!recoverySessionReady) {
          form.classList.add('hidden');
          setStatus('This reset link is invalid or has expired. Request a new one from the MailTrack options page.', 'error');
        }
      }, 3000);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        if (newPassword !== confirmPassword) {
          setStatus("Passwords don't match.", 'error');
          return;
        }
        if (!recoverySessionReady) {
          setStatus('Reset link not verified yet — wait a moment and try again.', 'error');
          return;
        }
        submitBtn.disabled = true;
        setStatus('Saving…', null);
        const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
        if (error) {
          submitBtn.disabled = false;
          setStatus(error.message, 'error');
          return;
        }
        form.classList.add('hidden');
        setStatus('Password updated. Go back to the MailTrack extension and log in with your new password. You can close this tab.', 'ok');
      });
    </script>
  </body>
</html>`;
}
