import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Variables } from './types';
import { messagesRoute } from './routes/messages';
import { pixelRoute } from './routes/pixel';
import { clickRoute } from './routes/click';
import { eventsRoute } from './routes/events';
import { getSupabase } from './db/client';
import { runClassifierSweep } from './classifier/sweep';
import { refreshAppleRelayRanges } from './classifier/intel-refresh';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get('/health', (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT }));

// Only the authenticated /v1/* API needs CORS at all — /p/* and /l/* are
// fetched as an <img> src / top-level navigation, neither of which is
// subject to CORS. env is only available per-request in Workers, so the
// cors() middleware is constructed fresh on each call rather than once at
// module scope. See PLAN.md Known Issues: ALLOWED_EXTENSION_ORIGIN is unset
// (permissive '*') until the extension is published and its real ID known.
app.use('/v1/*', (c, next) => cors({ origin: c.env.ALLOWED_EXTENSION_ORIGIN ?? '*' })(c, next));

app.route('/', messagesRoute);
app.route('/', pixelRoute);
app.route('/', clickRoute);
app.route('/', eventsRoute);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

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
