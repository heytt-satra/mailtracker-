import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyDodoWebhook } from '../src/lib/dodo-webhook';

/** Computed independently of the implementation under test, via Node's own crypto, to cross-verify the Standard Webhooks scheme rather than testing the code against itself. */
function signFixture(rawBody: string, id: string, timestamp: string, secret: string): string {
  const keyBytes = secret.startsWith('whsec_') ? Buffer.from(secret.slice('whsec_'.length), 'base64') : Buffer.from(secret);
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  return createHmac('sha256', keyBytes).update(signedContent).digest('base64');
}

const SECRET = 'whsec_' + Buffer.from('a-test-signing-key-32-bytes-long').toString('base64');
const BODY = JSON.stringify({ type: 'subscription.active', data: { subscription_id: 'sub_123' } });
const ID = 'msg_abc123';
const NOW = 1_700_000_000;

describe('verifyDodoWebhook', () => {
  it('accepts a correctly signed payload', async () => {
    const timestamp = String(NOW);
    const signature = `v1,${signFixture(BODY, ID, timestamp, SECRET)}`;
    const valid = await verifyDodoWebhook(BODY, { id: ID, timestamp, signature }, SECRET, NOW);
    expect(valid).toBe(true);
  });

  it('accepts a plain (non-whsec_-prefixed) secret the same way', async () => {
    const plainSecret = 'plain-secret-value';
    const timestamp = String(NOW);
    const signature = `v1,${signFixture(BODY, ID, timestamp, plainSecret)}`;
    const valid = await verifyDodoWebhook(BODY, { id: ID, timestamp, signature }, plainSecret, NOW);
    expect(valid).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const timestamp = String(NOW);
    const signature = `v1,${signFixture(BODY, ID, timestamp, SECRET)}`;
    const tamperedBody = JSON.stringify({ type: 'subscription.active', data: { subscription_id: 'sub_999-attacker-controlled' } });
    const valid = await verifyDodoWebhook(tamperedBody, { id: ID, timestamp, signature }, SECRET, NOW);
    expect(valid).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const timestamp = String(NOW);
    const signature = `v1,${signFixture(BODY, ID, timestamp, 'whsec_' + Buffer.from('a-different-key-entirely').toString('base64'))}`;
    const valid = await verifyDodoWebhook(BODY, { id: ID, timestamp, signature }, SECRET, NOW);
    expect(valid).toBe(false);
  });

  it('rejects a stale timestamp outside the 5-minute tolerance', async () => {
    const staleTimestamp = String(NOW - 10 * 60);
    const signature = `v1,${signFixture(BODY, ID, staleTimestamp, SECRET)}`;
    const valid = await verifyDodoWebhook(BODY, { id: ID, timestamp: staleTimestamp, signature }, SECRET, NOW);
    expect(valid).toBe(false);
  });

  it('accepts a multi-signature header (secret rotation) if any entry matches', async () => {
    const timestamp = String(NOW);
    const realSignature = signFixture(BODY, ID, timestamp, SECRET);
    const signature = `v1,not-a-real-signature v1,${realSignature}`;
    const valid = await verifyDodoWebhook(BODY, { id: ID, timestamp, signature }, SECRET, NOW);
    expect(valid).toBe(true);
  });
});
