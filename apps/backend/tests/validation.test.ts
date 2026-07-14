import { describe, expect, it } from 'vitest';
import { reportBounceSchema } from '../src/routes/bounces';
import { reportReplySchema } from '../src/routes/replies';
import { reportsQuerySchema } from '../src/routes/reports';
import { listMessagesQuerySchema } from '../src/routes/events';
import { createCheckoutSchema, dodoWebhookEventSchema } from '../src/routes/billing';

describe('reportBounceSchema (ADR-46)', () => {
  it('accepts a valid body', () => {
    expect(reportBounceSchema.safeParse({ recipientEmail: 'a@b.com', bounceReceivedAt: '2026-01-01T00:00:00.000Z' }).success).toBe(true);
  });

  it('rejects a malformed email instead of accepting it unchecked (previously had NO email format check at all)', () => {
    expect(reportBounceSchema.safeParse({ recipientEmail: 'not-an-email', bounceReceivedAt: '2026-01-01T00:00:00.000Z' }).success).toBe(false);
  });

  it('rejects an overlong recipientEmail instead of silently truncating it to 320 chars', () => {
    const longEmail = `${'a'.repeat(320)}@b.com`;
    expect(reportBounceSchema.safeParse({ recipientEmail: longEmail, bounceReceivedAt: '2026-01-01T00:00:00.000Z' }).success).toBe(false);
  });

  it('rejects an invalid bounceReceivedAt', () => {
    expect(reportBounceSchema.safeParse({ recipientEmail: 'a@b.com', bounceReceivedAt: 'not a date' }).success).toBe(false);
  });

  it('rejects an overlong subjectExcerpt instead of silently truncating it', () => {
    expect(reportBounceSchema.safeParse({ recipientEmail: 'a@b.com', bounceReceivedAt: '2026-01-01T00:00:00.000Z', subjectExcerpt: 'x'.repeat(201) }).success).toBe(false);
  });

  it('rejects unexpected extra fields', () => {
    expect(reportBounceSchema.safeParse({ recipientEmail: 'a@b.com', bounceReceivedAt: '2026-01-01T00:00:00.000Z', extra: 'x' }).success).toBe(false);
  });
});

describe('reportReplySchema (ADR-46)', () => {
  it('accepts a valid body', () => {
    expect(reportReplySchema.safeParse({ msgId: 'msg-1', detectedAt: '2026-01-01T00:00:00.000Z' }).success).toBe(true);
  });

  it('rejects a missing msgId', () => {
    expect(reportReplySchema.safeParse({ detectedAt: '2026-01-01T00:00:00.000Z' }).success).toBe(false);
  });

  it('rejects an invalid detectedAt', () => {
    expect(reportReplySchema.safeParse({ msgId: 'msg-1', detectedAt: 'garbage' }).success).toBe(false);
  });
});

describe('reportsQuerySchema (ADR-46)', () => {
  it('accepts "week" and "month"', () => {
    expect(reportsQuerySchema.safeParse({ period: 'week' }).success).toBe(true);
    expect(reportsQuerySchema.safeParse({ period: 'month' }).success).toBe(true);
  });

  it('accepts a missing period (legitimate default, not an error)', () => {
    expect(reportsQuerySchema.safeParse({ period: undefined }).success).toBe(true);
  });

  it('rejects a garbage period instead of silently defaulting to "week"', () => {
    expect(reportsQuerySchema.safeParse({ period: 'decade' }).success).toBe(false);
  });
});

describe('listMessagesQuerySchema (ADR-46)', () => {
  it('accepts a missing offset (legitimate default)', () => {
    expect(listMessagesQuerySchema.safeParse({ offset: undefined }).success).toBe(true);
  });

  it('accepts a valid non-negative integer offset', () => {
    expect(listMessagesQuerySchema.safeParse({ offset: '50' }).success).toBe(true);
  });

  it('rejects a negative offset instead of silently defaulting to 0', () => {
    expect(listMessagesQuerySchema.safeParse({ offset: '-5' }).success).toBe(false);
  });

  it('rejects a non-numeric offset instead of silently defaulting to 0', () => {
    expect(listMessagesQuerySchema.safeParse({ offset: 'not-a-number' }).success).toBe(false);
  });
});

describe('createCheckoutSchema (ADR-46)', () => {
  it('accepts "monthly" and "yearly"', () => {
    expect(createCheckoutSchema.safeParse({ plan: 'monthly' }).success).toBe(true);
    expect(createCheckoutSchema.safeParse({ plan: 'yearly' }).success).toBe(true);
  });

  it('rejects any other plan value', () => {
    expect(createCheckoutSchema.safeParse({ plan: 'lifetime' }).success).toBe(false);
  });
});

describe('dodoWebhookEventSchema (ADR-46)', () => {
  it('accepts a well-formed event', () => {
    const result = dodoWebhookEventSchema.safeParse({ type: 'subscription.active', data: { subscription_id: 'sub_123', metadata: { mailtrack_user_id: 'u1' } } });
    expect(result.success).toBe(true);
  });

  it('tolerates unknown extra fields Dodo might add in the future (NOT .strict() — this is a third-party payload)', () => {
    const result = dodoWebhookEventSchema.safeParse({ type: 'subscription.active', data: { subscription_id: 'sub_123', a_future_field_we_do_not_know_about: 'x' } });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing the required type field', () => {
    const result = dodoWebhookEventSchema.safeParse({ data: {} });
    expect(result.success).toBe(false);
  });

  it('rejects a payload where data.subscription_id is the wrong type', () => {
    const result = dodoWebhookEventSchema.safeParse({ type: 'subscription.active', data: { subscription_id: 12345 } });
    expect(result.success).toBe(false);
  });
});
