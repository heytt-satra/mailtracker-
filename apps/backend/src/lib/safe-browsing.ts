import type { Env } from '../types';

export type ReputationStatus = 'safe' | 'unsafe' | null;

// Budget within the extension's own COMPOSE_INJECTION_TIMEOUT_MS (4000ms,
// apps/extension/src/config.ts) minus normal insert latency — tight enough
// that a slow/unresponsive Safe Browsing call can't meaningfully delay a
// send, matching NFR2's fail-open philosophy for every other tracking step.
const SAFE_BROWSING_TIMEOUT_MS = 1200;

/**
 * ADR-59. Google Safe Browsing Lookup API v4 (threatMatches:find), one
 * batched request for every link in a send. Fails open: no API key
 * configured, a non-2xx response, a network error, or exceeding the tight
 * timeout budget all produce `null` (unchecked) for every URL rather than
 * blocking or rejecting the send — this is a warning signal layered on top
 * of tracking, never a hard gate (NFR2).
 */
export async function checkUrlsReputation(env: Env, urls: string[]): Promise<Map<string, ReputationStatus>> {
  const result = new Map<string, ReputationStatus>(urls.map((u) => [u, null]));
  if (urls.length === 0 || !env.SAFE_BROWSING_API_KEY) return result;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), SAFE_BROWSING_TIMEOUT_MS);
  try {
    const response = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${env.SAFE_BROWSING_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'mailtrack', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: urls.map((url) => ({ url })),
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return result; // fail open — bad key, quota exceeded, transient API error, etc.

    const body = (await response.json()) as { matches?: Array<{ threat: { url: string } }> };
    const flagged = new Set((body.matches ?? []).map((m) => m.threat.url));
    for (const url of urls) result.set(url, flagged.has(url) ? 'unsafe' : 'safe');
    return result;
  } catch {
    return result; // timeout (AbortError) or network error — fail open, everything stays unchecked
  } finally {
    clearTimeout(timeoutHandle);
  }
}
