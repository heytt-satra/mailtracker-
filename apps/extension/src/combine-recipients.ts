import type { ComposeView, Contact } from './inboxsdk-types';

/**
 * ADR-58. To + CC + BCC combined, deduped by lowercased email address (a
 * name-only difference — e.g. Gmail autocomplete filling in a display name
 * on a second mention — keeps whichever Contact was seen first). Kept in
 * its own module (rather than inline in inboxsdk-app.ts) so it's testable
 * under vitest's default node environment — inboxsdk-app.ts transitively
 * imports @inboxsdk/core, which touches `document` at module-load time and
 * throws outside a real browser/jsdom environment.
 */
export function combineRecipients(composeView: ComposeView): Contact[] {
  const seen = new Set<string>();
  const combined: Contact[] = [];
  for (const recipient of [...composeView.getToRecipients(), ...composeView.getCcRecipients(), ...composeView.getBccRecipients()]) {
    const key = recipient.emailAddress.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(recipient);
  }
  return combined;
}
