import { getSupabaseAuthClient } from './supabase-client';
import { MAILTRACK_API_BASE_URL } from './config';

/**
 * ADR-61 (Outlook add-in, C2). Copied from apps/extension/src/auth.ts,
 * minus signInWithGoogle (the one chrome.identity-dependent piece) — Google
 * sign-in for Outlook is out of scope for this MVP (email/password only).
 * Everything below is unchanged: plain Supabase Auth calls, no chrome
 * dependency, and the same backend confirmation/reset-password pages
 * (apps/backend/src/pages/) are reused as-is since they're already
 * client-agnostic.
 */

export type AuthResult = { ok: true; accessToken: string; email: string | null } | { ok: false; message: string };

export function mapAuthResponse(
  data: { session: { access_token: string } | null; user: { email?: string | null } | null } | null,
  error: { message: string } | null,
): AuthResult {
  if (error) return { ok: false, message: error.message };
  if (!data?.session?.access_token) {
    return { ok: false, message: 'Check your email to confirm your account, then log in.' };
  }
  return { ok: true, accessToken: data.session.access_token, email: data.user?.email ?? null };
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
  const emailRedirectTo = `${MAILTRACK_API_BASE_URL}/auth/confirmed`;
  const { data, error } = await getSupabaseAuthClient().auth.signUp({ email, password, options: { emailRedirectTo } });
  return mapAuthResponse(data, error);
}

export async function logInWithEmail(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await getSupabaseAuthClient().auth.signInWithPassword({ email, password });
  return mapAuthResponse(data, error);
}

export type PasswordResetRequestResult = { ok: true } | { ok: false; message: string };

export async function requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
  const redirectTo = `${MAILTRACK_API_BASE_URL}/auth/reset-password`;
  const { error } = await getSupabaseAuthClient().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
