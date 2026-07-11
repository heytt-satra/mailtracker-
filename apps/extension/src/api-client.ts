import type {
  CreateMessageRequest,
  CreateMessageResponse,
  EventsPollResponse,
  MessageListResponse,
  MessageStatusResponse,
  ReportBounceRequest,
  ReportBounceResponse,
  ReportReplyRequest,
  ReportReplyResponse,
  TimelineEvent,
} from '@mailtrack/shared';
import { MAILTRACK_API_BASE_URL } from './config';

export class MailTrackApiError extends Error {}

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
      throw new MailTrackApiError(`MailTrack API ${path} returned ${response.status}`);
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

export async function exportMessageCsv(apiKey: string, msgId: string): Promise<string> {
  const response = await fetch(`${MAILTRACK_API_BASE_URL}/v1/messages/${msgId}/export`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new MailTrackApiError(`Export failed with ${response.status}`);
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
  if (!response.ok) throw new MailTrackApiError(`Provisioning failed with ${response.status}`);
  return response.json();
}
