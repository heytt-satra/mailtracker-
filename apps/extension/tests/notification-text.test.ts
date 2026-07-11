import { describe, expect, it } from 'vitest';
import { buildNotificationText } from '../src/notification-text';

describe('buildNotificationText', () => {
  it('includes both recipient and subject for an opened event', () => {
    const { title, message } = buildNotificationText({
      msgId: 'm1',
      event: 'opened',
      occurredAt: '2026-01-01T00:00:00.000Z',
      recipient: 'jane@example.com',
      subject: 'Q3 proposal',
    });
    expect(title).toBe('MailTrack: verified');
    expect(message).toBe('jane@example.com opened your email "Q3 proposal".');
  });

  it('falls back to generic wording when recipient or subject is null (never captured)', () => {
    const { message } = buildNotificationText({
      msgId: 'm2',
      event: 'clicked',
      occurredAt: '2026-01-01T00:00:00.000Z',
      recipient: null,
      subject: null,
    });
    expect(message).toBe('a recipient clicked a link in your email.');
  });

  it('uses the bounced title and phrasing for a bounce', () => {
    const { title, message } = buildNotificationText({
      msgId: 'm3',
      event: 'bounced',
      occurredAt: '2026-01-01T00:00:00.000Z',
      recipient: 'bad@nowhere.invalid',
      subject: 'Hello',
    });
    expect(title).toBe('MailTrack: bounced');
    expect(message).toBe('bad@nowhere.invalid could not be delivered to your email "Hello".');
  });

  it('phrases a reply distinctly from an open/click', () => {
    const { message } = buildNotificationText({
      msgId: 'm4',
      event: 'replied',
      occurredAt: '2026-01-01T00:00:00.000Z',
      recipient: 'a@b.com',
      subject: null,
    });
    expect(message).toBe('a@b.com replied to your email.');
  });
});
