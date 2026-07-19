import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkUrlsReputation } from '../src/lib/safe-browsing';
import type { Env } from '../src/types';

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return { SAFE_BROWSING_API_KEY: 'test-key', ...overrides } as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkUrlsReputation (ADR-59)', () => {
  it('returns an empty map for an empty URL list without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await checkUrlsReputation(fakeEnv(), []);
    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails open with every URL unchecked (null) when no API key is configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await checkUrlsReputation(fakeEnv({ SAFE_BROWSING_API_KEY: undefined }), ['https://example.com']);
    expect(result.get('https://example.com')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('marks URLs with no threat match as safe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    const result = await checkUrlsReputation(fakeEnv(), ['https://example.com/safe']);
    expect(result.get('https://example.com/safe')).toBe('safe');
  });

  it('marks a URL present in the API response matches as unsafe, leaving other checked URLs safe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ matches: [{ threat: { url: 'https://evil.example.com/malware' } }] }),
      }),
    );
    const result = await checkUrlsReputation(fakeEnv(), ['https://evil.example.com/malware', 'https://example.com/fine']);
    expect(result.get('https://evil.example.com/malware')).toBe('unsafe');
    expect(result.get('https://example.com/fine')).toBe('safe');
  });

  it('fails open (unchecked) on a non-2xx response rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const result = await checkUrlsReputation(fakeEnv(), ['https://example.com']);
    expect(result.get('https://example.com')).toBeNull();
  });

  it('fails open (unchecked) when fetch itself throws (network error or timeout abort)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await checkUrlsReputation(fakeEnv(), ['https://example.com']);
    expect(result.get('https://example.com')).toBeNull();
  });
});
