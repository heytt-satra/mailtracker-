import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessage, deleteMessage, getMessageStatus, MailTrackApiError, pollEvents, provisionApiKey } from '../src/api-client';

describe('api-client', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('createMessage sends a Bearer-authenticated POST and returns the parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ msgId: 'm1', pixelUrl: 'https://x/p/t.gif', linkMap: {} }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createMessage('secret-key', { linkUrls: ['https://a.com'] }, 1500);

    expect(result.msgId).toBe('m1');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer secret-key');
    expect(JSON.parse(init.body)).toEqual({ linkUrls: ['https://a.com'] });
  });

  it('throws MailTrackApiError on a non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    await expect(getMessageStatus('bad-key', 'm1')).rejects.toBeInstanceOf(MailTrackApiError);
  });

  it('createMessage rejects when the request exceeds the timeout (fail-open contract for the caller)', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const promise = createMessage('key', { linkUrls: [] }, 1500);
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1600);
    await assertion;
    vi.useRealTimers();
  });

  it('deleteMessage issues a DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deleted: true }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await deleteMessage('key', 'm1');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('pollEvents encodes the since timestamp as a query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ polledAt: 'x', updates: [] }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await pollEvents('key', '2026-07-08T00:00:00.000Z');
    expect(fetchMock.mock.calls[0][0]).toContain('since=2026-07-08T00%3A00%3A00.000Z');
  });

  it('provisionApiKey sends the Supabase access token as the Bearer, not a MailTrack API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ apiKey: 'new-key', email: 'a@b.com' }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await provisionApiKey('supabase-jwt-abc');

    expect(result).toEqual({ apiKey: 'new-key', email: 'a@b.com' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/auth/provision');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer supabase-jwt-abc');
  });

  it('provisionApiKey throws MailTrackApiError on failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    await expect(provisionApiKey('bad-token')).rejects.toBeInstanceOf(MailTrackApiError);
  });
});
