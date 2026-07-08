import { getSupabaseAuthClient } from './supabase-client';

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
  const { data, error } = await getSupabaseAuthClient().auth.signUp({ email, password });
  return mapAuthResponse(data, error);
}

export async function logInWithEmail(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await getSupabaseAuthClient().auth.signInWithPassword({ email, password });
  return mapAuthResponse(data, error);
}
