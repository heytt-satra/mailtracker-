import { describe, expect, it } from 'vitest';
import { correlateBounce } from '../src/bounce-correlation';

const REPORT = { recipientEmail: 'bounced@example.com', bounceReceivedAt: '2026-01-03T00:00:00.000Z' };

describe('correlateBounce', () => {
  it('returns no match when no candidate was sent to that recipient', () => {
    const result = correlateBounce([{ id: '1', recipient: 'someone-else@example.com', subject: 'hi', sentAt: '2026-01-01T00:00:00.000Z' }], REPORT);
    expect(result.matchedMsgId).toBeNull();
  });

  it('matches the single unambiguous candidate by recipient address', () => {
    const result = correlateBounce([{ id: '1', recipient: 'bounced@example.com', subject: 'hi', sentAt: '2026-01-01T00:00:00.000Z' }], REPORT);
    expect(result.matchedMsgId).toBe('1');
    expect(result.reason).toMatch(/recipient address/i);
  });

  it('matches recipient substring inside a multi-recipient string', () => {
    const result = correlateBounce(
      [{ id: '1', recipient: 'a@example.com, bounced@example.com, c@example.com', subject: 'hi', sentAt: '2026-01-01T00:00:00.000Z' }],
      REPORT,
    );
    expect(result.matchedMsgId).toBe('1');
  });

  it('ignores a candidate sent AFTER the bounce arrived — cannot be the cause', () => {
    const result = correlateBounce([{ id: '1', recipient: 'bounced@example.com', subject: 'hi', sentAt: '2026-01-15T00:00:00.000Z' }], REPORT);
    expect(result.matchedMsgId).toBeNull();
  });

  it('ignores a candidate sent too long before the bounce (outside the plausible delay window)', () => {
    const result = correlateBounce([{ id: '1', recipient: 'bounced@example.com', subject: 'hi', sentAt: '2025-11-01T00:00:00.000Z' }], REPORT);
    expect(result.matchedMsgId).toBeNull();
  });

  it('withholds a match when multiple sends to the same recipient exist and there is no subject excerpt to disambiguate', () => {
    const result = correlateBounce(
      [
        { id: '1', recipient: 'bounced@example.com', subject: 'first', sentAt: '2026-01-01T00:00:00.000Z' },
        { id: '2', recipient: 'bounced@example.com', subject: 'second', sentAt: '2026-01-02T00:00:00.000Z' },
      ],
      REPORT,
    );
    expect(result.matchedMsgId).toBeNull();
    expect(result.reason).toMatch(/could not be disambiguated/i);
  });

  it('disambiguates multiple candidates using a matching subject excerpt', () => {
    const result = correlateBounce(
      [
        { id: '1', recipient: 'bounced@example.com', subject: 'Invoice #123', sentAt: '2026-01-01T00:00:00.000Z' },
        { id: '2', recipient: 'bounced@example.com', subject: 'Meeting notes', sentAt: '2026-01-02T00:00:00.000Z' },
      ],
      { ...REPORT, subjectExcerpt: 'Invoice' },
    );
    expect(result.matchedMsgId).toBe('1');
  });

  it('still withholds a match if the subject excerpt matches more than one candidate', () => {
    const result = correlateBounce(
      [
        { id: '1', recipient: 'bounced@example.com', subject: 'Invoice #123', sentAt: '2026-01-01T00:00:00.000Z' },
        { id: '2', recipient: 'bounced@example.com', subject: 'Invoice #456', sentAt: '2026-01-02T00:00:00.000Z' },
      ],
      { ...REPORT, subjectExcerpt: 'Invoice' },
    );
    expect(result.matchedMsgId).toBeNull();
  });

  it('is case-insensitive on both recipient and subject matching', () => {
    const result = correlateBounce(
      [{ id: '1', recipient: 'Bounced@Example.com', subject: 'INVOICE', sentAt: '2026-01-01T00:00:00.000Z' }],
      { ...REPORT, recipientEmail: 'bounced@example.com' },
    );
    expect(result.matchedMsgId).toBe('1');
  });
});
