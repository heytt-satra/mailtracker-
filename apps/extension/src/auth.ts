import { getSupabaseAuthClient } from './supabase-client';
import { MAILTRACK_API_BASE_URL } from './config';

export type AuthResult = { ok: true; accessToken: string; email: string | null } | { ok: false; message: string };

/**
 * Pure mapping from Supabase's {data, error} shape to our own result type —
 * separated from the actual signUp/signInWithPassword calls so it's
 * unit-testable without mocking the Supabase client itself (tests/auth.test.ts).
 */
export function mapAuthResponse(
  data: { session: { access_token: string } | null; user: { email?: string | null } | null } | null,
  error: { message: string } | null,
): AuthResult {
  if (error) return { ok: false, message: error.message };
  if (!data?.session?.access_token) {
    // Real Supabase behavior when email confirmation is required: signUp
    // succeeds but returns no session until the user clicks the confirmation
    // link. Surface this distinctly rather than a generic failure.
    return { ok: false, message: 'Check your email to confirm your account, then log in.' };
  }
  return { ok: true, accessToken: data.session.access_token, email: data.user?.email ?? null };
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
  // MailTrack has no regular website for Supabase's confirmation email to
  // land on — without this, it falls back to the project's default Site
  // URL (an unconfigured localhost, since nobody set one up for a project
  // whose only client is a Chrome extension). Must also be added to the
  // Supabase project's Redirect URLs allow-list (Authentication > URL
  // Configuration) or Supabase will silently fall back to Site URL anyway.
  const emailRedirectTo = `${MAILTRACK_API_BASE_URL}/auth/confirmed`;
  const { data, error } = await getSupabaseAuthClient().auth.signUp({ email, password, options: { emailRedirectTo } });
  return mapAuthResponse(data, error);
}

export async function logInWithEmail(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await getSupabaseAuthClient().auth.signInWithPassword({ email, password });
  return mapAuthResponse(data, error);
}

/**
 * ADR-56 (Google sign-in). Supabase's own `signInWithOAuth` assumes a
 * normal web page it can redirect the whole tab to — that doesn't exist for
 * an MV3 extension. Instead: ask Supabase for the provider authorization
 * URL without letting it redirect (`skipBrowserRedirect: true`), hand that
 * URL to `chrome.identity.launchWebAuthFlow` (the extension-platform
 * equivalent of a redirect flow, requires the `identity` permission),
 * which opens it in a controlled window and returns the final callback URL
 * once Supabase completes the exchange and redirects to this extension's
 * fixed `https://<id>.chromiumapp.org/` URI (obtained via
 * `chrome.identity.getRedirectURL()` — must be registered in the Supabase
 * project's Auth > URL Configuration > Redirect URLs allow-list; the
 * Google Cloud OAuth client's own redirect URI is Supabase's fixed
 * `https://<project-ref>.supabase.co/auth/v1/callback`, a separate,
 * one-time step in Google Cloud Console + Supabase's provider settings).
 * Supabase returns tokens in the callback URL's fragment (implicit-style),
 * which `setSession` uses to hydrate a real session identical in shape to
 * the email/password paths, so `handleAuthResult` in options/popup needs
 * no special-casing.
 */
export async function signInWithGoogle(): Promise<AuthResult> {
  if (typeof chrome === 'undefined' || !chrome.identity?.launchWebAuthFlow) {
    return { ok: false, message: 'Google sign-in is only available in the installed extension, not this preview.' };
  }
  const redirectTo = chrome.identity.getRedirectURL();
  const client = getSupabaseAuthClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return { ok: false, message: error?.message ?? 'Could not start Google sign-in.' };

  let callbackUrl: string | undefined;
  try {
    callbackUrl = await chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true });
  } catch (e) {
    // The user closing the Google auth window themselves also lands here —
    // that's a cancellation, not a real error, so no scary message for it.
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('did not approve') || message.includes('closed')) {
      return { ok: false, message: 'Google sign-in was cancelled.' };
    }
    return { ok: false, message: 'Google sign-in failed to complete.' };
  }
  if (!callbackUrl) return { ok: false, message: 'Google sign-in was cancelled.' };

  const fragment = new URL(callbackUrl).hash.replace(/^#/, '');
  const params = new URLSearchParams(fragment);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) {
    const errorDescription = params.get('error_description');
    return { ok: false, message: errorDescription ?? 'Google sign-in did not return a valid session.' };
  }

  const { data: sessionData, error: sessionError } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return mapAuthResponse(sessionData, sessionError);
}

export type PasswordResetRequestResult = { ok: true } | { ok: false; message: string };

/**
 * ADR-49. Sends Supabase's own password-recovery email — MailTrack never
 * sees or handles the actual password reset, only asks Supabase to start
 * it. `redirectTo` points at a new backend page (apps/backend/src/pages/
 * reset-password.ts) since the extension itself can't be the target of an
 * email link opened in a normal browser tab. Deliberately returns `{ok:
 * true}` even when Supabase's response would reveal whether the email
 * exists — see the call site in options/main.ts for why the UI shows the
 * same message either way (never confirm/deny account existence via a
 * public "forgot password" form).
 */
export async function requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
  const redirectTo = `${MAILTRACK_API_BASE_URL}/auth/reset-password`;
  const { error } = await getSupabaseAuthClient().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
