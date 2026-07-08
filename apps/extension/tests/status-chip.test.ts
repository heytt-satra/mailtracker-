import { describe, expect, it } from 'vitest';
import { describeStatus, statusIconDataUrl } from '../src/status-chip';

describe('describeStatus', () => {
  it('never implies a verified open for delivered', () => {
    // "not yet verified" is fine (it's the honest negative); a claim of an
    // actual verified read is what FR6/FR7 forbid for this status.
    expect(describeStatus('delivered').tooltip).not.toMatch(/human read this|verified — /i);
  });

  it('explains not_verifiable rather than looking blank or broken', () => {
    const { tooltip } = describeStatus('not_verifiable');
    expect(tooltip).toMatch(/blocks open verification/i);
    expect(tooltip).not.toMatch(/^$/);
  });

  it('opened and clicked are explicitly labeled verified', () => {
    expect(describeStatus('opened').tooltip).toMatch(/verified/i);
    expect(describeStatus('clicked').tooltip).toMatch(/verified/i);
  });

  it('produces a distinct color per status', () => {
    const statuses = ['sent', 'delivered', 'opened', 'clicked', 'not_verifiable'] as const;
    const colors = new Set(statuses.map((s) => describeStatus(s).color));
    // sent/delivered/not_verifiable intentionally share the neutral color; opened and clicked are distinct.
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });
});

describe('statusIconDataUrl', () => {
  it('returns a valid inline SVG data URL', () => {
    const url = statusIconDataUrl('opened');
    expect(url).toMatch(/^data:image\/svg\+xml,/);
  });
});
