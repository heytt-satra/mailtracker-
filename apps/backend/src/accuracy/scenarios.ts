import type { AsnIntel, ClassificationInput, RawFetchEvent, Verdict } from '@mailtrack/shared';

/**
 * Labeled ground-truth corpus for the accuracy harness (PLAN.md ADR-23).
 *
 * Each scenario is a real-world situation whose CORRECT verdict is known
 * independently of MailTrack's classifier — drawn from documented client
 * behavior (Apple MPP egress ranges, scanner ASNs, Gmail's image proxy,
 * prefetch timing) and the product's own regression fixtures (PLAN.md §15).
 * The harness runs each through the real classifier and scores the result
 * against `expected`, so the accuracy number it produces is measured against
 * this labeled set — not asserted. This is the ONLY honest basis for any
 * displayed accuracy figure; a scenario's label is the ground truth.
 *
 * `clientContext` documents where the pattern comes from, so the corpus is
 * auditable rather than a black box. Coverage is deliberately balanced across
 * both the positive cases (real humans that MUST verify) and the negative
 * cases (machines that MUST NOT), because a classifier that only ever said
 * "verified" would score 100% on a positive-only set and be worthless.
 */
export interface ClassifierScenario {
  name: string;
  clientContext: string;
  input: ClassificationInput;
  expected: Verdict;
}

const APPLE_MPP: AsnIntel = { asn: 714, orgName: 'Apple Inc. Private Relay', category: 'apple_mpp' };
const SCANNER_ASN: AsnIntel = { asn: 19679, orgName: 'Proofpoint Inc.', category: 'security_scanner' };
const RESIDENTIAL_ASN: AsnIntel = { asn: 7922, orgName: 'Comcast', category: 'residential_isp' };

function event(overrides: Partial<RawFetchEvent> = {}): RawFetchEvent {
  return { messageId: 'm', kind: 'pixel_fetch', occurredAtMs: 0, userAgent: null, ip: '203.0.113.10', headers: {}, fetchSequenceMs: 120_000, ...overrides };
}
function input(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return { event: event(), asnIntel: null, ipCategory: null, burstFetchCount: 1, isFirstFetch: false, ...overrides };
}

export const CLASSIFIER_SCENARIOS: ClassifierScenario[] = [
  // ---- MUST verify: genuine human activity ----
  {
    name: 'Gmail proxy open, 2 min after send',
    clientContext: 'Gmail web/app: images fetched through GoogleImageProxy at render time, outside the prefetch window',
    input: input({ event: event({ userAgent: 'Mozilla/5.0 GoogleImageProxy', fetchSequenceMs: 120_000 }), isFirstFetch: true }),
    expected: 'verified_open',
  },
  {
    name: 'Delayed repeat fetch, residential ISP, browser UA',
    clientContext: 'Recipient reopens the email hours later from a normal browser on a home connection',
    input: input({
      event: event({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36', fetchSequenceMs: 3_600_000 }),
      asnIntel: RESIDENTIAL_ASN,
      isFirstFetch: false,
    }),
    expected: 'verified_open',
  },
  {
    name: 'Genuine link click, no scanner signal',
    clientContext: 'Recipient clicks a tracked link from a normal client',
    input: input({ event: event({ kind: 'link_click', userAgent: 'Mozilla/5.0 (Macintosh) Safari/605' }) }),
    expected: 'verified_click',
  },
  {
    name: 'Link click via Apple Private Relay egress',
    clientContext: 'Private Relay proxies content the user requested but never auto-follows links, so a click through it is a real human click',
    input: input({ event: event({ kind: 'link_click', userAgent: 'Mozilla/5.0 Safari' }), ipCategory: 'apple_mpp' }),
    expected: 'verified_click',
  },

  // ---- MUST NOT verify: machine activity (the whole point of the product) ----
  {
    name: 'Apple Mail Privacy Protection prefetch (IP range)',
    clientContext: 'Apple MPP fetches every pixel server-side within seconds of delivery, from a published egress range',
    input: input({ event: event({ fetchSequenceMs: 3_000 }), ipCategory: 'apple_mpp', isFirstFetch: true }),
    expected: 'not_verifiable',
  },
  {
    name: 'Apple MPP prefetch (ASN fallback)',
    clientContext: 'Same as above but matched via ASN rather than IP range',
    input: input({ event: event({ fetchSequenceMs: 4_000 }), asnIntel: APPLE_MPP, isFirstFetch: true }),
    expected: 'not_verifiable',
  },
  {
    name: 'Security scanner burst (10 fetches in 500ms)',
    clientContext: 'A mail gateway pre-scans every resource in a message at delivery, producing a burst',
    input: input({ event: event({ fetchSequenceMs: 400 }), burstFetchCount: 10, isFirstFetch: true }),
    expected: 'machine_suspect',
  },
  {
    name: 'Security scanner ASN pixel fetch',
    clientContext: 'Proofpoint/Mimecast-class gateway fetching from a known scanner ASN',
    input: input({ event: event({ userAgent: 'Proofpoint/2.1' }), asnIntel: SCANNER_ASN }),
    expected: 'machine_suspect',
  },
  {
    name: 'Security scanner link pre-visit',
    clientContext: 'Microsoft Safe Links / Proofpoint URL Defense auto-visits a rewritten link before delivery',
    input: input({ event: event({ kind: 'link_click', userAgent: 'ms-office' }), asnIntel: SCANNER_ASN }),
    expected: 'machine_suspect',
  },
  {
    name: 'Notification-preview-only fetch, immediate, non-proxy',
    clientContext: 'A phone notification preview fetches the pixel within seconds of send from a non-Gmail-proxy UA',
    input: input({ event: event({ userAgent: 'Mozilla/5.0 (iPhone)', fetchSequenceMs: 2_000 }), isFirstFetch: true }),
    expected: 'machine_suspect',
  },
  {
    name: 'Generic bot user-agent',
    clientContext: 'A crawler/automated fetcher with a curl/bot user-agent',
    input: input({ event: event({ userAgent: 'curl/8.4.0' }) }),
    expected: 'machine_suspect',
  },
];
