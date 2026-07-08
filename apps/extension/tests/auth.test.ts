import { describe, expect, it } from 'vitest';
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
