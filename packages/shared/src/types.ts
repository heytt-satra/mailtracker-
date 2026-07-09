// Shared between apps/backend and apps/extension. No runtime code, types only.

export type MessageStatus = 'sent' | 'delivered' | 'opened' | 'clicked' | 'not_verifiable';

export type EventKind = 'pixel_fetch' | 'link_click';

export type Verdict = 'machine_suspect' | 'verified_open' | 'verified_click' | 'not_verifiable';

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
  linkUrls: string[];
}

export interface CreateMessageResponse {
  msgId: string;
  pixelUrl: string;
  linkMap: Record<string, string>; // originalUrl -> tracked redirect URL
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
  status: MessageStatus;
  sentAt: string;
  /** Count of raw_events classified verified_open — how many times a human read this, not just whether. */
  openCount: number;
  /** Count of raw_events classified verified_click. */
  clickCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
}

export interface MessageListResponse {
  messages: MessageSummary[];
  nextOffset: number | null;
}
