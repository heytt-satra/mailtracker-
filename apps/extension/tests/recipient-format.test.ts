import { describe, expect, it } from 'vitest';
import { formatRecipients } from '../src/recipient-format';

describe('formatRecipients', () => {
  it('returns an empty string for no recipients', () => {
    expect(formatRecipients([])).toBe('');
  });

  it('joins a small number of recipients with commas', () => {
    const result = formatRecipients([
      { name: 'Alice', emailAddress: 'alice@example.com' },
      { name: 'Bob', emailAddress: 'bob@example.com' },
    ]);
    expect(result).toBe('alice@example.com, bob@example.com');
  });

  it('truncates with a "+N more" suffix beyond the max', () => {
    const recipients = Array.from({ length: 5 }, (_, i) => ({ name: `User ${i}`, emailAddress: `user${i}@example.com` }));
    const result = formatRecipients(recipients, 3);
    expect(result).toBe('user0@example.com, user1@example.com, user2@example.com +2 more');
  });

  it('does not truncate when the count exactly equals maxShown', () => {
    const recipients = [
      { name: 'A', emailAddress: 'a@example.com' },
      { name: 'B', emailAddress: 'b@example.com' },
      { name: 'C', emailAddress: 'c@example.com' },
    ];
    expect(formatRecipients(recipients, 3)).toBe('a@example.com, b@example.com, c@example.com');
  });
});
