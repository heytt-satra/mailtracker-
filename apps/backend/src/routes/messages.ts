import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { CreateMessageResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import { getRawEventTimingForMessage, getSupabase, hasActiveSubscription, insertBeaconTokens, insertLinkTokens, insertMessage } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { randomToken } from '../lib/crypto';
import { checkRateLimit, getClientIp, ONE_MINUTE_MS, rateLimitedResponse, readRateLimitInt } from '../lib/rate-limit';
import { parseJsonBody } from '../lib/validate';

export const messagesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * ADR-19: only messages whose composed HTML body is already this long get
 * depth beacons at all. Gmail's well-documented "message clipped" behavior
 * truncates the rendered DOM at roughly 102KB of the assembled message
 * (quoted history included, which the extension's bodyLength measurement
 * doesn't see) — staying comfortably under that with this gate means a
 * message this long is very likely to actually clip, so the resulting
 * depthReached signal means what it claims. For the common case (a normal,
 * much-shorter email), no beacons are generated at all: injecting them
 * would just be redundant noise indistinguishable from the ordinary
 * top-pixel open, plus unnecessary deliverability/load-time cost for zero
 * new information (see docs/read-detection-plan.md §8 risks).
 */
const LONG_MESSAGE_BEACON_THRESHOLD_BYTES = 90_000;

// A real email body doesn't have hundreds of distinct links; this is a
// sanity cap against a malformed/malicious client turning one send into an
// unbounded batch insert, not a business rule.
const MAX_LINK_URLS = 50;

// Gmail itself doesn't hard-cap subject length, but nothing needs more than
// this for a dashboard list row.
const MAX_SUBJECT_LENGTH = 500;
const MAX_RECIPIENT_LENGTH = 500;

/**
 * ADR-52 incident fix: `linkUrls` entries are the RAW `href` attribute value
 * of every link in the composed HTML (apps/extension/src/html-injection.ts
 * ::extractLinkUrls — zero filtering on the extension side), so a real email
 * routinely contains non-URL or non-http(s) hrefs: `mailto:`, `cid:` inline-
 * image references, bare `#anchor` fragments, malformed pasted text. An
 * earlier version of this schema required every entry to pass `z.string()
 * .url()`, which REJECTED THE ENTIRE REQUEST — not just that one link — the
 * moment a single such href appeared, which is the common case, not an edge
 * case. That silently broke tracking in production (confirmed live: zero
 * messages created for a paying account, 400s visible in the browser
 * console, nothing in server logs since the request never got that far).
 * Fixed by only requiring an array of strings here; `isTrackableUrl()`
 * below is the correct place for the http(s)-only filter — a FILTER, not a
 * rejection, so one weird link never fails the whole send (NFR2 fail-open).
 * Every other field still rejects outright on mismatch (`.strict()` too) —
 * this was never about being lenient everywhere, just about not rejecting
 * a wholly ordinary email over a scheme its own compose UI generated.
 */
export const createMessageSchema = z
  .object({
    linkUrls: z.array(z.string()).max(MAX_LINK_URLS),
    gmailMessageId: z.string().max(200).optional(),
    subject: z.string().trim().max(MAX_SUBJECT_LENGTH).optional(),
    recipient: z.string().trim().max(MAX_RECIPIENT_LENGTH).optional(),
    bodyLength: z.number().int().nonnegative().optional(),
  })
  .strict();

messagesRoute.post('/v1/messages', apiKeyAuth, async (c) => {
  const userId = c.get('userId');

  // Bounds the blast radius of a leaked/compromised API key — 30 tracked
  // sends/minute (configurable via RATE_LIMIT_WRITES_PER_MIN) is generous
  // for a human composing email, well below what a spam/abuse script would
  // want to do with a stolen key. Shared "writes" bucket with bounces.ts/
  // replies.ts (ADR-45) — same reasoning as before the DO-based rewrite.
  const writeLimit = readRateLimitInt(c.env.RATE_LIMIT_WRITES_PER_MIN, 30);
  const { allowed, retryAfterSeconds } = await checkRateLimit(c.env, `writes:${userId}`, { limit: writeLimit, windowMs: ONE_MINUTE_MS, backoff: false });
  if (!allowed) return rateLimitedResponse(c, retryAfterSeconds);

  // ADR-36: subscription gate. Only NEW tracking is blocked — a lapsed
  // subscription never touches already-tracked messages or dashboard
  // history, both of which read straight through this route.
  const db = getSupabase(c.env);
  if (!(await hasActiveSubscription(db, userId))) {
    return c.json({ error: 'An active MailTrack subscription is required to track new emails.' }, 402);
  }

  const parsed = await parseJsonBody(c, createMessageSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Scheme filter, not a rejection — see createMessageSchema's doc comment.
  const validLinkUrls = body.linkUrls.filter(isTrackableUrl);
  const subject = body.subject || undefined; // an all-whitespace subject trims to '' — treat the same as omitted, not an error
  const recipient = body.recipient || undefined;

  const pixelToken = randomToken();

  const message = await insertMessage(db, { userId, gmailMessageId: body.gmailMessageId, subject, recipient, pixelToken });

  const linkTokens = validLinkUrls.map((originalUrl) => ({ token: randomToken(), originalUrl }));
  await insertLinkTokens(db, message.id, linkTokens);

  const origin = new URL(c.req.url).origin;
  const response: CreateMessageResponse = {
    msgId: message.id,
    pixelUrl: `${origin}/p/${pixelToken}.gif`,
    linkMap: Object.fromEntries(linkTokens.map((l) => [l.originalUrl, `${origin}/l/${l.token}`])),
  };

  if (typeof body.bodyLength === 'number' && body.bodyLength > LONG_MESSAGE_BEACON_THRESHOLD_BYTES) {
    const midToken = randomToken();
    const bottomToken = randomToken();
    await insertBeaconTokens(db, message.id, [
      { token: midToken, position: 'mid' },
      { token: bottomToken, position: 'bottom' },
    ]);
    response.beaconUrls = { mid: `${origin}/b/${midToken}.gif`, bottom: `${origin}/b/${bottomToken}.gif` };
  }

  return c.json(response, 201);
});

/**
 * ADR-57 (Track B Phase 0, temporary — delete once the empirical test
 * concludes, per docs/read-detection-plan.md). Read-only, admin-secret-gated
 * diagnostic: returns every raw_events row for one message in arrival order,
 * with beacon position and fetch-sequence timing — everything needed to
 * answer Track B's make-or-break question by inspecting a real test send.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

messagesRoute.get('/v1/admin/beacon-timing', async (c) => {
  const rateLimited = await checkAdminRateLimit(c);
  if (rateLimited) return rateLimited;
  if (!hasValidAdminSecret(c)) return c.json({ error: 'Unauthorized' }, 401);
  const messageId = c.req.query('messageId');
  if (!messageId) return c.json({ error: 'messageId query param is required' }, 400);
  // messages.id is a Postgres uuid column — an invalid UUID literal makes
  // Supabase throw, which without this check surfaced as an opaque 500
  // (found live, via curl, testing this route right after deploying it).
  if (!UUID_RE.test(messageId)) return c.json({ error: 'messageId must be a valid UUID' }, 400);
  const db = getSupabase(c.env);
  const events = await getRawEventTimingForMessage(db, messageId);
  return c.json({ messageId, events });
});

function hasValidAdminSecret(c: Context<{ Bindings: Env; Variables: Variables }>): boolean {
  const providedSecret = c.req.header('X-Admin-Secret');
  return !!providedSecret && providedSecret === c.env.ADMIN_SECRET;
}

/** Same shared-secret-plus-per-IP-limit pattern as billing.ts's admin routes (ADR-48). */
async function checkAdminRateLimit(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const ip = getClientIp(c.req.header('CF-Connecting-IP'));
  const limit = readRateLimitInt(c.env.RATE_LIMIT_ADMIN_PER_MIN, 5);
  const { allowed, retryAfterSeconds } = await checkRateLimit(c.env, `admin:ip:${ip}`, { limit, windowMs: ONE_MINUTE_MS, backoff: true });
  return allowed ? null : rateLimitedResponse(c, retryAfterSeconds);
}

/**
 * Only http(s) URLs are worth rewriting into a tracked redirect — mailto:,
 * tel:, and malformed strings would just make `/l/:token` a confusing or
 * broken redirect target. Filtering here (rather than 400ing the whole
 * request) keeps a single bad link from blocking the rest of a legitimate
 * send, consistent with the fail-open philosophy elsewhere (NFR2).
 */
export function isTrackableUrl(candidate: string): boolean {
  try {
    const protocol = new URL(candidate).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
