import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Variables } from './types';
import { messagesRoute } from './routes/messages';
import { pixelRoute } from './routes/pixel';
import { beaconRoute } from './routes/beacon';
import { clickRoute } from './routes/click';
import { eventsRoute } from './routes/events';
import { authRoute } from './routes/auth';
import { bouncesRoute } from './routes/bounces';
import { repliesRoute } from './routes/replies';
import { billingRoute } from './routes/billing';
import { reportsRoute } from './routes/reports';
import { attachmentsRoute } from './routes/attachments';
import { organizationsRoute } from './routes/organizations';
import { LANDING_PAGE_HTML } from './pages/landing';
import { PRIVACY_POLICY_HTML } from './pages/privacy';
import { getSupabase } from './db/client';
import { runClassifierSweep } from './classifier/sweep';
import { refreshAppleRelayRanges } from './classifier/intel-refresh';

// ADR-45. Durable Object classes must be exported from the Worker's main
// module (referenced by class_name in wrangler.toml's durable_objects
// binding) — re-exporting here rather than defining the class in this file
// keeps rate-limiter-do.ts self-contained and independently readable.
export { RateLimiterDO } from './rate-limiter-do';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get('/health', (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT }));

// Public marketing page — no auth, no CORS concerns (plain browser navigation).
app.get('/', (c) => c.html(LANDING_PAGE_HTML));

// Required by the Chrome Web Store before the extension can publish (any
// item that collects user data must link a live privacy policy URL).
app.get('/privacy', (c) => c.html(PRIVACY_POLICY_HTML));

// Only the authenticated /v1/* API needs CORS at all — /p/*, /b/*, and /l/*
// are fetched as an <img> src / top-level navigation, neither of which is
// subject to CORS. env is only available per-request in Workers, so the
// cors() middleware is constructed fresh on each call rather than once at
// module scope. See PLAN.md Known Issues: ALLOWED_EXTENSION_ORIGIN is unset
// (permissive '*') until the extension is published and its real ID known.
app.use('/v1/*', (c, next) => cors({ origin: c.env.ALLOWED_EXTENSION_ORIGIN ?? '*' })(c, next));

app.route('/', authRoute);
app.route('/', messagesRoute);
app.route('/', pixelRoute);
app.route('/', beaconRoute);
app.route('/', clickRoute);
app.route('/', eventsRoute);
app.route('/', bouncesRoute);
app.route('/', repliesRoute);
app.route('/', billingRoute);
app.route('/', reportsRoute);
app.route('/', attachmentsRoute);
app.route('/', organizationsRoute);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

/**
 * ADR-46 (error handling / information leakage). Hono's own default error
 * handler already logs server-side and returns an opaque body on an
 * uncaught exception (confirmed by reading hono-base.js directly — no
 * stack trace, no error message, ever reaches the response) — this
 * override isn't fixing a leak, it's fixing an inconsistency: every other
 * error in this API is `{ error: string }` JSON, while Hono's default
 * returns plain text, which a JSON-only API client could choke on.
 * `console.error` still runs first so nothing here reduces server-side
 * debuggability.
 */
app.onError((err, c) => {
  console.error(`[unhandled] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default {
  fetch: app.fetch,

  // wrangler.toml declares two cron expressions: "* * * * *" (classifier
  // sweep, every minute) and "0 3 * * 1" (weekly Apple relay range refresh).
  // Both land here; distinguish by event.cron rather than running both on
  // every trigger.
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = getSupabase(env);

    if (event.cron === '* * * * *') {
      const result = await runClassifierSweep(db);
      console.log(`classifier sweep: processed=${result.processed} escalated=${result.escalated}`);
      return;
    }

    if (event.cron === '0 3 * * 1') {
      try {
        const result = await refreshAppleRelayRanges(db);
        console.log(`apple relay range refresh: ${result.ranges} ranges`);
      } catch (err) {
        // Fail open: a failed refresh leaves last week's ranges in place
        // rather than blocking classification. Log for operator visibility.
        console.error('apple relay range refresh failed', err);
      }
      return;
    }
  },
};
