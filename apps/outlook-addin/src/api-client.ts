import type { CreateMessageRequest, CreateMessageResponse } from '@mailtrack/shared';
import { MAILTRACK_API_BASE_URL } from './config';

/**
 * ADR-61 (Outlook add-in, C2). Trimmed copy of apps/extension/src/api-client.ts
 * — only what this MVP needs (createMessage, provisionApiKey). Both clients
 * hit the exact same backend routes; no backend changes were needed for
 * Outlook support (see PLAN.md).
 */
export class MailTrackApiError extends Error {
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

/** Called from the on-send handler (functions.ts). NFR2 (fail-open): the caller times this out and lets the send proceed untracked — see COMPOSE_INJECTION_TIMEOUT_MS in config.ts. */
export function createMessage(apiKey: string, body: CreateMessageRequest, timeoutMs: number): Promise<CreateMessageResponse> {
  return request<CreateMessageResponse>('/v1/messages', apiKey, { method: 'POST', body: JSON.stringify(body) }, timeoutMs);
}

export async function provisionApiKey(supabaseAccessToken: string): Promise<{ apiKey: string; email: string | null }> {
  const response = await fetch(`${MAILTRACK_API_BASE_URL}/v1/auth/provision`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${supabaseAccessToken}` },
  });
  if (!response.ok) throw new MailTrackApiError(`Provisioning failed with ${response.status}`, response.status);
  return response.json();
}
