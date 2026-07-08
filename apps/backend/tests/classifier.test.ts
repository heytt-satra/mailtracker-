import { describe, expect, it } from 'vitest';
import type { AsnIntel, ClassificationInput, RawFetchEvent } from '@mailtrack/shared';
import { classifyEvent } from '../src/classifier/rules';
import { nextStatus, verdictToStatus } from '../src/classifier/escalation';
import { classifyUserAgent } from '../src/classifier/useragent';
import { isWithinPrefetchWindow } from '../src/classifier/timing';

function baseEvent(overrides: Partial<RawFetchEvent> = {}): RawFetchEvent {
  return {
    messageId: 'msg-1',
    kind: 'pixel_fetch',
    occurredAtMs: 0,
    userAgent: 'Mozilla/5.0 GoogleImageProxy',
    ip: '203.0.113.10',
    headers: {},
    fetchSequenceMs: 120_000,
    ...overrides,
  };
}

function baseInput(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return {
    event: baseEvent(),
    asnIntel: null,
    ipCategory: null,
    burstFetchCount: 1,
    isFirstFetch: false,
    ...overrides,
  };
}

const APPLE_MPP: AsnIntel = { asn: 714, orgName: 'Apple Inc. Private Relay', category: 'apple_mpp' };
const SCANNER_ASN: AsnIntel = { asn: 19679, orgName: 'Proofpoint Inc.', category: 'security_scanner' };

describe('unit: timing filter', () => {
  it('flags fetches inside the 45s prefetch window', () => {
    expect(isWithinPrefetchWindow(1_000)).toBe(true);
    expect(isWithinPrefetchWindow(45_000)).toBe(true);
  });
  it('does not flag fetches outside the window', () => {
    expect(isWithinPrefetchWindow(45_001)).toBe(false);
    expect(isWithinPrefetchWindow(3_600_000)).toBe(false);
  });
});

describe('unit: user-agent classifier', () => {
  it('recognizes GoogleImageProxy', () => {
    expect(classifyUserAgent('Mozilla/5.0 (compatible) GoogleImageProxy')).toBe('gmail_proxy');
  });
  it('recognizes known scanners', () => {
    expect(classifyUserAgent('Mimecast/1.0')).toBe('known_scanner');
    expect(classifyUserAgent('Proofpoint-Scanner/2.1')).toBe('known_scanner');
  });
  it('recognizes generic bots', () => {
    expect(classifyUserAgent('curl/8.4.0')).toBe('generic_bot');
  });
  it('returns unknown for null UA', () => {
    expect(classifyUserAgent(null)).toBe('unknown');
  });
});

describe('unit: escalation ladder', () => {
  it('never downgrades an already-clicked status', () => {
    expect(nextStatus('clicked', 'machine_suspect')).toBe('clicked');
    expect(nextStatus('clicked', 'not_verifiable')).toBe('clicked');
  });
  it('never downgrades an already-opened status', () => {
    expect(nextStatus('opened', 'machine_suspect')).toBe('opened');
  });
  it('escalates sent -> delivered on machine_suspect', () => {
    expect(nextStatus('sent', 'machine_suspect')).toBe('delivered');
  });
  it('escalates delivered -> opened on verified_open', () => {
    expect(nextStatus('delivered', 'verified_open')).toBe('opened');
  });
  it('opened can still escalate to clicked', () => {
    expect(nextStatus('opened', 'verified_click')).toBe('clicked');
  });
  it('not_verifiable can still escalate to opened later', () => {
    expect(nextStatus('not_verifiable', 'verified_open')).toBe('opened');
  });
  it('maps verdicts to their canonical status', () => {
    expect(verdictToStatus('verified_click')).toBe('clicked');
    expect(verdictToStatus('verified_open')).toBe('opened');
    expect(verdictToStatus('not_verifiable')).toBe('not_verifiable');
    expect(verdictToStatus('machine_suspect')).toBe('delivered');
  });
});

describe('regression: permanent fixtures (PLAN.md section 15)', () => {
  it('1. notification-preview-only fetch never escalates past delivered (immediate, non-proxy UA)', () => {
    const result = classifyEvent(
      baseInput({
        event: baseEvent({ userAgent: 'AppleMailPreview/1.0', fetchSequenceMs: 2_000 }),
        isFirstFetch: true,
      }),
    );
    expect(result.verdict).not.toBe('verified_open');
    expect(nextStatus('sent', result.verdict)).not.toBe('opened');
  });

  it('2. Apple MPP fetch within 5s of send never escalates to opened', () => {
    const result = classifyEvent(
      baseInput({
        event: baseEvent({ fetchSequenceMs: 5_000 }),
        asnIntel: APPLE_MPP,
        isFirstFetch: true,
      }),
    );
    expect(result.verdict).toBe('not_verifiable');
    expect(nextStatus('sent', result.verdict)).not.toBe('opened');
  });

  it('3. scanner burst (10 fetches within 500ms) never escalates past delivered', () => {
    const result = classifyEvent(
      baseInput({
        event: baseEvent({ fetchSequenceMs: 500 }),
        burstFetchCount: 10,
        isFirstFetch: true,
      }),
    );
    expect(result.verdict).toBe('machine_suspect');
    expect(nextStatus('sent', result.verdict)).toBe('delivered');
  });

  it('4. repeat fetch 2h later (human pattern) escalates to opened after an initial machine-pattern fetch', () => {
    const firstFetch = classifyEvent(
      baseInput({
        event: baseEvent({ fetchSequenceMs: 3_000 }),
        isFirstFetch: true,
      }),
    );
    const statusAfterFirst = nextStatus('sent', firstFetch.verdict);
    expect(statusAfterFirst).not.toBe('opened');

    const secondFetch = classifyEvent(
      baseInput({
        event: baseEvent({ fetchSequenceMs: 2 * 60 * 60 * 1000, userAgent: 'Mozilla/5.0 GoogleImageProxy' }),
        isFirstFetch: false,
      }),
    );
    expect(secondFetch.verdict).toBe('verified_open');
    expect(nextStatus(statusAfterFirst, secondFetch.verdict)).toBe('opened');
  });

  it('5. a link click from an Apple Private Relay egress still escalates to clicked', () => {
    // Private Relay only proxies content the device actually requests — it
    // does not auto-follow links in a message body — so unlike a pixel
    // fetch, a click via this ASN is a normal human click.
    const clickResult = classifyEvent(
      baseInput({
        event: baseEvent({ kind: 'link_click', userAgent: null, fetchSequenceMs: 1_000 }),
        asnIntel: APPLE_MPP,
      }),
    );
    expect(clickResult.verdict).toBe('verified_click');
    expect(nextStatus('not_verifiable', clickResult.verdict)).toBe('clicked');
  });

  it('5b. a link click pre-visited by a security-scanner ASN does NOT escalate to clicked', () => {
    // Microsoft Safe Links / Proofpoint URL Defense / Mimecast rewrite links
    // and auto-visit them server-side to scan before the recipient ever
    // opens the email — the click-side analog of the pixel prefetch problem.
    const clickResult = classifyEvent(
      baseInput({
        event: baseEvent({ kind: 'link_click', userAgent: null, fetchSequenceMs: 500 }),
        asnIntel: SCANNER_ASN,
      }),
    );
    expect(clickResult.verdict).toBe('machine_suspect');
    expect(nextStatus('delivered', clickResult.verdict)).toBe('delivered');
  });

  it('5c. a link click from a known scanner user-agent does NOT escalate to clicked', () => {
    const clickResult = classifyEvent(
      baseInput({
        event: baseEvent({ kind: 'link_click', userAgent: 'Mimecast/1.0', fetchSequenceMs: 500 }),
      }),
    );
    expect(clickResult.verdict).toBe('machine_suspect');
  });

  it('6. once opened, a later machine_suspect classification does not revert status', () => {
    const laterSuspect = classifyEvent(
      baseInput({
        event: baseEvent({ userAgent: 'Mimecast/1.0', fetchSequenceMs: 10_000 }),
        isFirstFetch: false,
      }),
    );
    expect(laterSuspect.verdict).toBe('machine_suspect');
    expect(nextStatus('opened', laterSuspect.verdict)).toBe('opened');
  });
});

describe('additional edge cases', () => {
  it('IP-range Apple MPP match takes priority over a missing/different ASN category', () => {
    const result = classifyEvent(
      baseInput({
        event: baseEvent({ fetchSequenceMs: 3_000 }),
        ipCategory: 'apple_mpp',
        asnIntel: null, // relay egress rode an unrelated CDN ASN, ASN table has no opinion
        isFirstFetch: true,
      }),
    );
    expect(result.verdict).toBe('not_verifiable');
    expect(result.reason).toMatch(/Private Relay egress range/i);
  });

  it('security scanner ASN is suppressed even with a browser-like UA', () => {
    const result = classifyEvent(
      baseInput({
        event: baseEvent({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', fetchSequenceMs: 1_000 }),
        asnIntel: SCANNER_ASN,
        isFirstFetch: true,
      }),
    );
    expect(result.verdict).toBe('machine_suspect');
  });

  it('unknown ASN + unknown UA + outside prefetch window still withholds verification', () => {
    const result = classifyEvent(
      baseInput({
        event: baseEvent({ userAgent: null, fetchSequenceMs: 500_000 }),
        isFirstFetch: false,
      }),
    );
    expect(result.verdict).toBe('machine_suspect');
    expect(result.reason).toMatch(/insufficient/i);
  });
});
