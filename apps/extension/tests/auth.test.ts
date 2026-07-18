import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapAuthResponse } from '../src/auth';

describe('mapAuthResponse', () => {
  it('maps a successful session to ok:true with the access token', () => {
    const result = mapAuthResponse({ session: { access_token: 'tok123' }, user: { email: 'a@b.com' } }, null);
    expect(result).toEqual({ ok: true, accessToken: 'tok123', email: 'a@b.com' });
  });

  it('maps a Supabase error to ok:false with its message', () => {
    const result = mapAuthResponse(null, { message: 'Invalid login credentials' });
    expect(result).toEqual({ ok: false, message: 'Invalid login credentials' });
  });

  it('maps a signUp with no session (email confirmation required) to a distinct, actionable message', () => {
    const result = mapAuthResponse({ session: null, user: { email: 'a@b.com' } }, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/confirm your account/i);
  });

  it('handles a null user gracefully (email falls back to null, not a crash)', () => {
    const result = mapAuthResponse({ session: { access_token: 'tok' }, user: null }, null);
    expect(result).toEqual({ ok: true, accessToken: 'tok', email: null });
  });
});

// ADR-56. signInWithGoogle needs both chrome.identity (extension platform
// API, not present under vitest by default) and the Supabase client mocked
// — these tests cover the pure control flow (URL fragment parsing,
// cancellation vs real failure, the outside-extension guard) rather than
// re-testing Supabase itself.
describe('signInWithGoogle', () => {
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.doUnmock('../src/supabase-client');
  });

  it('fails clearly when chrome.identity is unavailable (e.g. a non-extension preview)', async () => {
    // @ts-expect-error deliberately simulating the "not running as an extension" case
    globalThis.chrome = undefined;
    const { signInWithGoogle } = await import('../src/auth');
    const result = await signInWithGoogle();
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/only available in the installed extension/i) });
  });

  it('parses access_token/refresh_token out of the launchWebAuthFlow callback URL and hydrates a session', async () => {
    vi.doMock('../src/supabase-client', () => ({
      getSupabaseAuthClient: () => ({
        auth: {
          signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: 'https://supabase.example/authorize' }, error: null }),
          setSession: vi.fn().mockResolvedValue({
            data: { session: { access_token: 'real-token' }, user: { email: 'g@example.com' } },
            error: null,
          }),
        },
      }),
    }));
    globalThis.chrome = {
      identity: {
        getRedirectURL: () => 'https://abc123.chromiumapp.org/',
        launchWebAuthFlow: vi
          .fn()
          .mockResolvedValue('https://abc123.chromiumapp.org/#access_token=real-token&refresh_token=refresh-1&token_type=bearer'),
      },
    } as unknown as typeof chrome;
    const { signInWithGoogle } = await import('../src/auth');
    const result = await signInWithGoogle();
    expect(result).toEqual({ ok: true, accessToken: 'real-token', email: 'g@example.com' });
  });

  it('treats a cancelled/closed auth window as a cancellation, not a scary error', async () => {
    vi.doMock('../src/supabase-client', () => ({
      getSupabaseAuthClient: () => ({
        auth: { signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: 'https://supabase.example/authorize' }, error: null }) },
      }),
    }));
    globalThis.chrome = {
      identity: {
        getRedirectURL: () => 'https://abc123.chromiumapp.org/',
        launchWebAuthFlow: vi.fn().mockRejectedValue(new Error('The user did not approve access.')),
      },
    } as unknown as typeof chrome;
    const { signInWithGoogle } = await import('../src/auth');
    const result = await signInWithGoogle();
    expect(result).toEqual({ ok: false, message: 'Google sign-in was cancelled.' });
  });

  it('surfaces a Supabase-provided error_description when the callback carries no tokens', async () => {
    vi.doMock('../src/supabase-client', () => ({
      getSupabaseAuthClient: () => ({
        auth: { signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: 'https://supabase.example/authorize' }, error: null }) },
      }),
    }));
    globalThis.chrome = {
      identity: {
        getRedirectURL: () => 'https://abc123.chromiumapp.org/',
        launchWebAuthFlow: vi
          .fn()
          .mockResolvedValue('https://abc123.chromiumapp.org/#error=access_denied&error_description=User+denied+access'),
      },
    } as unknown as typeof chrome;
    const { signInWithGoogle } = await import('../src/auth');
    const result = await signInWithGoogle();
    expect(result).toEqual({ ok: false, message: 'User denied access' });
  });
});
