import type {
  BillingStatusResponse,
  CancelSubscriptionResponse,
  CreateCheckoutRequest,
  CreateCheckoutResponse,
  CreateInviteResponse,
  CreateMessageRequest,
  CreateMessageResponse,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  EventsPollResponse,
  GetOrganizationResponse,
  JoinOrganizationRequest,
  JoinOrganizationResponse,
  MessageListResponse,
  MessageStatusResponse,
  OrgMessagesResponse,
  ReportBounceRequest,
  ReportBounceResponse,
  ReportPeriod,
  ReportReplyRequest,
  ReportReplyResponse,
  ReportsResponse,
  TimelineEvent,
} from '@mailtrack/shared';
import { MAILTRACK_API_BASE_URL } from './config';

export class MailTrackApiError extends Error {
  /** ADR-36. Lets callers distinguish e.g. 402 (subscription required) from a generic failure without parsing the message string. */
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, apiKey: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${MAILTRACK_API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${apiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!response.ok) {
      throw new MailTrackApiError(`MailTrack API ${path} returned ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Called from the compose "presending" hook. NFR2 (fail-open): the caller is
 * responsible for timing this out and letting the send proceed untracked —
 * see COMPOSE_INJECTION_TIMEOUT_MS in config.ts and its usage in
 * src/inboxsdk-app.ts. This function itself does not swallow errors; the
 * caller decides what "fail open" means at the call site.
 */
export function createMessage(apiKey: string, body: CreateMessageRequest, timeoutMs: number): Promise<CreateMessageResponse> {
  return request<CreateMessageResponse>('/v1/messages', apiKey, { method: 'POST', body: JSON.stringify(body) }, timeoutMs);
}

/** Dashboard message list (M5), newest-first, paginated via nextOffset. */
export function listMessages(apiKey: string, offset = 0): Promise<MessageListResponse> {
  return request<MessageListResponse>(`/v1/messages?offset=${offset}`, apiKey);
}

export function getMessageStatus(apiKey: string, msgId: string): Promise<MessageStatusResponse> {
  return request<MessageStatusResponse>(`/v1/messages/${msgId}/status`, apiKey);
}

export function getMessageTimeline(apiKey: string, msgId: string): Promise<{ msgId: string; status: string; events: TimelineEvent[] }> {
  return request(`/v1/messages/${msgId}/events`, apiKey);
}

export function pollEvents(apiKey: string, sinceIso: string): Promise<EventsPollResponse> {
  return request(`/v1/events/poll?since=${encodeURIComponent(sinceIso)}`, apiKey);
}

/** ADR-36. Creates a Dodo checkout session for the given plan; the caller opens the returned URL. */
export function createCheckout(apiKey: string, body: CreateCheckoutRequest): Promise<CreateCheckoutResponse> {
  return request<CreateCheckoutResponse>('/v1/billing/checkout', apiKey, { method: 'POST', body: JSON.stringify(body) });
}

export function getBillingStatus(apiKey: string): Promise<BillingStatusResponse> {
  return request<BillingStatusResponse>('/v1/billing/status', apiKey);
}

/** ADR-44. Cancels the caller's active subscription — a free-lifetime grant cancels immediately, a real Dodo subscription cancels at the end of the current billing period. The response's `message` says which. */
export function cancelSubscription(apiKey: string): Promise<CancelSubscriptionResponse> {
  return request<CancelSubscriptionResponse>('/v1/billing/cancel', apiKey, { method: 'POST' });
}

/** ADR-39. Weekly/monthly report — every number is a real aggregate over already-tracked data. */
export function getReports(apiKey: string, period: ReportPeriod): Promise<ReportsResponse> {
  return request<ReportsResponse>(`/v1/reports?period=${period}`, apiKey);
}

/**
 * ADR-42. Uploads a PDF for "Attach tracked PDF" — deliberately NOT built on
 * request() above, since that helper always sets a JSON Content-Type for
 * any body; this needs application/pdf and a raw binary body instead.
 */
export async function uploadAttachment(apiKey: string, file: Blob): Promise<{ url: string }> {
  const response = await fetch(`${MAILTRACK_API_BASE_URL}/v1/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/pdf' },
    body: file,
  });
  if (!response.ok) throw new MailTrackApiError(`Attachment upload failed with ${response.status}`, response.status);
  return response.json();
}

export async function exportMessageCsv(apiKey: string, msgId: string): Promise<string> {
  const response = await fetch(`${MAILTRACK_API_BASE_URL}/v1/messages/${msgId}/export`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new MailTrackApiError(`Export failed with ${response.status}`, response.status);
  return response.text();
}

export function deleteMessage(apiKey: string, msgId: string): Promise<{ deleted: boolean }> {
  return request(`/v1/messages/${msgId}`, apiKey, { method: 'DELETE' });
}

/** ADR-20. Called when the inbox watcher (src/bounce-detection.ts + inboxsdk-app.ts) recognizes a bounce notification. */
export function reportBounce(apiKey: string, body: ReportBounceRequest): Promise<ReportBounceResponse> {
  return request<ReportBounceResponse>('/v1/bounces', apiKey, { method: 'POST', body: JSON.stringify(body) });
}

/** ADR-21. Called when the thread watcher detects a reply from the recipient in a tracked thread. */
export function reportReply(apiKey: string, body: ReportReplyRequest): Promise<ReportReplyResponse> {
  return request<ReportReplyResponse>('/v1/replies', apiKey, { method: 'POST', body: JSON.stringify(body) });
}

/**
 * Exchanges a Supabase access token (from signup/login, see src/auth.ts) for
 * a MailTrack API key. Deliberately NOT built on `request()` above — that
 * helper's `apiKey` param is our own long-lived credential, whereas this
 * call's Bearer token is a short-lived Supabase session token, a different
 * credential type used exactly once per signup/login.
 */
export async function provisionApiKey(supabaseAccessToken: string): Promise<{ apiKey: string; email: string | null }> {
  const response = await fetch(`${MAILTRACK_API_BASE_URL}/v1/auth/provision`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${supabaseAccessToken}` },
  });
  if (!response.ok) throw new MailTrackApiError(`Provisioning failed with ${response.status}`, response.status);
  return response.json();
}

// ADR-60 (team accounts). getOrganization() returns { organization: null }
// (not a 404) for "not in a team" — the caller checks the field, no
// try/catch needed for the common case.
export function createOrganization(apiKey: string, body: CreateOrganizationRequest): Promise<CreateOrganizationResponse> {
  return request<CreateOrganizationResponse>('/v1/orgs', apiKey, { method: 'POST', body: JSON.stringify(body) });
}

export function getOrganization(apiKey: string): Promise<GetOrganizationResponse> {
  return request<GetOrganizationResponse>('/v1/orgs/me', apiKey);
}

/** Owner-only — the backend rejects this with 403 for a non-owner member. */
export function createOrgInvite(apiKey: string): Promise<CreateInviteResponse> {
  return request<CreateInviteResponse>('/v1/orgs/invite', apiKey, { method: 'POST' });
}

export function joinOrganization(apiKey: string, body: JoinOrganizationRequest): Promise<JoinOrganizationResponse> {
  return request<JoinOrganizationResponse>('/v1/orgs/join', apiKey, { method: 'POST', body: JSON.stringify(body) });
}

/** Non-owner members only — the backend rejects this for the owner (delete the team instead). */
export function leaveOrganization(apiKey: string): Promise<{ left: boolean }> {
  return request('/v1/orgs/leave', apiKey, { method: 'POST' });
}

/** Owner-only — cascades members and invites. */
export function deleteOrganization(apiKey: string): Promise<{ deleted: boolean }> {
  return request('/v1/orgs', apiKey, { method: 'DELETE' });
}

/** Same pagination shape as listMessages, scoped to every member of the caller's team. */
export function listOrgMessages(apiKey: string, offset = 0): Promise<OrgMessagesResponse> {
  return request<OrgMessagesResponse>(`/v1/orgs/messages?offset=${offset}`, apiKey);
}
