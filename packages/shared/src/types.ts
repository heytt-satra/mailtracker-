// Shared between apps/backend and apps/extension. No runtime code, types only.

export type MessageStatus = 'sent' | 'delivered' | 'opened' | 'clicked' | 'not_verifiable';

export type EventKind = 'pixel_fetch' | 'link_click';

export type Verdict = 'machine_suspect' | 'verified_open' | 'verified_click' | 'not_verifiable';

/**
 * "Did they actually read it" verdict, distinct from MessageStatus's
 * send-pipeline ladder (sent/delivered/opened/clicked). Computed from the
 * pattern of verified_open/verified_click timestamps already captured —
 * no new tracking mechanism, no fabricated duration. See PLAN.md ADR-18
 * and docs/read-detection-plan.md for why exact seconds-open isn't
 * claimed here: Cloudflare Workers cannot detect stream disconnection
 * (confirmed empirically), so "read for exactly Ns" is not measurable.
 * `read`/`likely_read` carry real evidence; `not_verifiable` means we saw
 * only automated activity (prefetch/scanner), never a guess dressed up as
 * a number.
 */
export type ReadConfidence = 'read' | 'likely_read' | 'glanced' | 'not_verifiable';

/** Position of a Track B depth beacon within the compose body. 'top' is the original ADR-1 pixel; mid/bottom are ADR-19. */
export type BeaconPosition = 'top' | 'mid' | 'bottom';

/**
 * How far into a long message a verified fetch reached, per ADR-19. Only
 * meaningful for messages long enough to trigger Gmail's ~102KB "message
 * clipped" truncation — for a normal short email, mid/bottom beacons are
 * never even generated (see LONG_MESSAGE_BEACON_THRESHOLD_BYTES), so this
 * stays null rather than implying a depth claim that isn't actually
 * provable for a short, fully-visible message.
 */
export type DepthReached = 'mid' | 'bottom' | null;

export interface RawFetchEvent {
  messageId: string;
  kind: EventKind;
  occurredAtMs: number;
  userAgent: string | null;
  ip: string;
  headers: Record<string, string>;
  /** milliseconds elapsed since the message's sentAt, used by the timing filter */
  fetchSequenceMs: number;
}

export type IntelCategory = 'apple_mpp' | 'security_scanner' | 'residential_isp' | 'datacenter_other' | 'unknown';

export interface AsnIntel {
  asn: number;
  orgName: string | null;
  category: IntelCategory;
}

export interface ClassificationInput {
  event: RawFetchEvent;
  asnIntel: AsnIntel | null;
  /**
   * Result of matching the request IP against published egress ranges
   * (currently Apple Private Relay). Distinct from asnIntel: Apple relay
   * egress doesn't reliably map to a fixed ASN (it can ride third-party CDN
   * partner ASNs), so this is resolved via IP-range containment instead —
   * see PLAN.md ADR-8. Takes priority over asnIntel for apple_mpp detection.
   */
  ipCategory: IntelCategory | null;
  /** count of distinct resource fetches for this message within the same 2-second window as this event */
  burstFetchCount: number;
  /** true if no earlier raw_event exists for this message (this is the first fetch observed) */
  isFirstFetch: boolean;
}

export interface ClassificationResult {
  verdict: Verdict;
  reason: string;
}

export interface CreateMessageRequest {
  gmailMessageId?: string;
  /** Plaintext, shown back to the sender in the dashboard (M5) — see db/migrations/0001_init.sql comment on messages.subject. */
  subject?: string;
  /** Plaintext "To" recipients, joined — the primary dashboard identifier (subject alone can't tell repeat sends apart). See db/migrations/0002_add_recipient.sql. */
  recipient?: string;
  linkUrls: string[];
  /**
   * Byte length of the composed HTML body, measured client-side before
   * injection (`composeView.getHTMLContent().length`). Used only to decide
   * whether this message is long enough to plausibly hit Gmail's clip
   * threshold and therefore worth generating depth beacons for (ADR-19) —
   * never stored or shown back to the sender.
   */
  bodyLength?: number;
}

export interface CreateMessageResponse {
  msgId: string;
  pixelUrl: string;
  linkMap: Record<string, string>; // originalUrl -> tracked redirect URL
  /** Present only when bodyLength exceeded the long-message threshold (ADR-19) — absent means "don't bother injecting depth beacons." */
  beaconUrls?: { mid: string; bottom: string };
}

export interface MessageStatusResponse {
  msgId: string;
  status: MessageStatus;
  statusUpdatedAt: string;
}

export interface TimelineEvent {
  occurredAt: string;
  kind: EventKind;
  verdict: Verdict;
  reason: string;
  /** suppressed events (machine_suspect) are shown greyed out in the UI, not hidden */
  suppressed: boolean;
}

/** One row in the dashboard's message list (M5). */
export interface MessageSummary {
  msgId: string;
  subject: string | null;
  /** Primary dashboard identifier — see CreateMessageRequest.recipient. */
  recipient: string | null;
  status: MessageStatus;
  sentAt: string;
  /** Count of raw_events classified verified_open — how many times a human read this, not just whether. */
  openCount: number;
  /** Count of raw_events classified verified_click. */
  clickCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  /**
   * null = no read-signal data yet (message not opened/clicked, nothing to
   * judge). Never null once openCount > 0 or machine-only activity was seen
   * — see computeReadSignal in apps/backend/src/db/client.ts.
   */
  readConfidence: ReadConfidence | null;
  /** Proven lower bound only (open->click gap), never an estimate of true dwell time. Null when not derivable. */
  minEngagedSeconds: number | null;
  /** Human-readable justification shown in the dashboard — the evidence IS the product (Track E, "never fabricate"). */
  readEvidence: string | null;
  /** ADR-19. Only ever set for messages long enough to have generated depth beacons in the first place. */
  depthReached: DepthReached;
}

export interface MessageListResponse {
  messages: MessageSummary[];
  nextOffset: number | null;
}
