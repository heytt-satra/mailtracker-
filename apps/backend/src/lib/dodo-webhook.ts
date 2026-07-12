/**
 * Dodo Payments webhooks follow the Standard Webhooks spec (same scheme as
 * Svix): HMAC-SHA256 over "{webhook-id}.{webhook-timestamp}.{raw body}",
 * base64-encoded, compared against the (possibly multi-value,
 * space-separated, each "v1,<sig>") webhook-signature header. Confirmed
 * against Dodo's own docs and their official Supabase webhook-handler
 * example (github.com/dodopayments/cloud-functions) rather than assumed —
 * this is exactly the kind of code this project doesn't guess on. Their
 * example also validates a 5-minute timestamp tolerance against replay.
 */

const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

export interface DodoWebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

export async function verifyDodoWebhook(rawBody: string, headers: DodoWebhookHeaders, secret: string, nowSeconds: number): Promise<boolean> {
  const timestampSeconds = Number(headers.timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const expected = await computeSignature(rawBody, headers.id, headers.timestamp, secret);
  const provided = headers.signature.split(' ').map((part) => part.split(',').pop() ?? '');
  return provided.some((sig) => constantTimeEqual(sig, expected));
}

async function computeSignature(rawBody: string, id: string, timestamp: string, secret: string): Promise<string> {
  const keyBytes = secret.startsWith('whsec_') ? base64Decode(secret.slice('whsec_'.length)) : new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  return base64Encode(new Uint8Array(digest));
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Constant-time string comparison — a payment webhook signature check is exactly the kind of comparison that must not leak timing information. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
