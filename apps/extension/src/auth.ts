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
