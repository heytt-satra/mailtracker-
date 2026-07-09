import { describe, expect, it } from 'vitest';
import { extractBounceDetails, isBounceSender } from '../src/bounce-detection';

describe('isBounceSender', () => {
  it('recognizes mailer-daemon addresses', () => {
    expect(isBounceSender({ name: 'Mail Delivery Subsystem', emailAddress: 'mailer-daemon@googlemail.com' })).toBe(true);
  });

  it('recognizes postmaster addresses', () => {
    expect(isBounceSender({ name: '', emailAddress: 'postmaster@example.com' })).toBe(true);
  });

  it('does not flag an ordinary sender', () => {
    expect(isBounceSender({ name: 'A Colleague', emailAddress: 'colleague@example.com' })).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isBounceSender({ name: '', emailAddress: 'Mailer-Daemon@Googlemail.com' })).toBe(true);
  });
});

describe('extractBounceDetails', () => {
  it('extracts recipient, subject, and diagnostic from a realistic "address not found" bounce', () => {
    const body = `
Delivery to the following recipient failed permanently:

     baduser@example.com

Technical details of permanent failure:
Google tried to deliver your message, but it was rejected by the recipient domain. We recommend contacting the other email provider for further information about the cause of this error. The error that the other server returned was: 550 5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient's email address for typos or unnecessary spaces. Learn more at https://support.google.com/mail/?p=NoSuchUser

----- Original message -----

Message-ID: <abc123@mail.gmail.com>
Date: Thu, 9 Jan 2026 10:00:00 -0800
Subject: Invoice #123
From: heyttsatra17@gmail.com
To: baduser@example.com
`;
    const result = extractBounceDetails(body);
    expect(result.recipientEmail).toBe('baduser@example.com');
    expect(result.subjectExcerpt).toBe('Invoice #123');
    expect(result.diagnostic).toMatch(/550 5\.1\.1/);
  });

  it('extracts details from a mailbox-full permanent failure with different diagnostic wording', () => {
    const body = `
Delivery to the following recipient failed permanently:

     full@example.com

Technical details of permanent failure:
The recipient's mailbox is full and can't accept new messages.
550-5.2.2 mailbox full, quota exceeded

----- Original message -----
Subject: Re: Project update
`;
    const result = extractBounceDetails(body);
    expect(result.recipientEmail).toBe('full@example.com');
    expect(result.subjectExcerpt).toBe('Re: Project update');
    expect(result.diagnostic).toMatch(/550-5\.2\.2/);
  });

  it('does NOT match a temporary/delayed delivery notice — soft bounces are not hard bounces', () => {
    const body = `
Delivery to the following recipient has been delayed:

     slowuser@example.com

Message will be retried for 47 more hours.

The response from the remote server was:
450 4.2.1 The user you are trying to contact is receiving mail too quickly.

----- Original message -----
Subject: Following up
`;
    const result = extractBounceDetails(body);
    expect(result.recipientEmail).toBeNull();
  });

  it('returns all nulls for an ordinary, non-bounce email body', () => {
    const body = 'Hey, just following up on our call yesterday. Let me know your thoughts. Subject to change based on your feedback.';
    const result = extractBounceDetails(body);
    expect(result.recipientEmail).toBeNull();
    expect(result.diagnostic).toBeNull();
  });

  it('returns null subject/diagnostic gracefully when only the recipient line is present', () => {
    const body = 'Delivery to the following recipient failed permanently:\n\n     minimal@example.com\n';
    const result = extractBounceDetails(body);
    expect(result.recipientEmail).toBe('minimal@example.com');
    expect(result.subjectExcerpt).toBeNull();
    expect(result.diagnostic).toBeNull();
  });
});
