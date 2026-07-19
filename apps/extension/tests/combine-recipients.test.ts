import { describe, expect, it } from 'vitest';
import { combineRecipients } from '../src/combine-recipients';
import type { ComposeView, Contact } from '../src/inboxsdk-types';

function fakeComposeView(to: Contact[], cc: Contact[], bcc: Contact[]): ComposeView {
  return {
    getToRecipients: () => to,
    getCcRecipients: () => cc,
    getBccRecipients: () => bcc,
  } as unknown as ComposeView;
}

const A = { name: 'Alice', emailAddress: 'alice@example.com' };
const B = { name: 'Bob', emailAddress: 'bob@example.com' };
const C = { name: 'Carol', emailAddress: 'carol@example.com' };

describe('combineRecipients (ADR-58)', () => {
  it('returns just the To recipients when CC/BCC are empty', () => {
    expect(combineRecipients(fakeComposeView([A], [], []))).toEqual([A]);
  });

  it('combines To, CC, and BCC into one flat list', () => {
    expect(combineRecipients(fakeComposeView([A], [B], [C]))).toEqual([A, B, C]);
  });

  it('dedupes the same email address appearing in more than one field, case-insensitively, keeping the first occurrence', () => {
    const bccDuplicateOfTo = { name: '', emailAddress: 'ALICE@EXAMPLE.COM' };
    const result = combineRecipients(fakeComposeView([A], [B], [bccDuplicateOfTo]));
    expect(result).toEqual([A, B]);
  });

  it('handles a fully empty compose (no recipients yet) without throwing', () => {
    expect(combineRecipients(fakeComposeView([], [], []))).toEqual([]);
  });
});
