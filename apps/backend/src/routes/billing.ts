import { Hono } from 'hono';
import type { BillingStatusResponse, CancelSubscriptionResponse, CreateCheckoutRequest, CreateCheckoutResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import {
  getActiveSubscriptionForUser,
  getAllUserIds,
  getSupabase,
  getUserById,
  grantLifetimeSubscription,
  hasActiveSubscription,
  markSubscriptionStatus,
  normalizeLegacyPlaceholderSubscriptions,
  upsertSubscription,
  type SubscriptionStatus,
} from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { verifyDodoWebhook } from '../lib/dodo-webhook';

/** ADR-44. Synthetic dodo_subscription_id prefix for free-lifetime grants — never a real Dodo id, so it's the marker for "cancel locally, don't call Dodo's API." */
const LIFETIME_GRANT_PREFIX = 'free_lifetime_';

export const billingRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Defaults to test mode on a missing/unset var — a misconfigured deploy should fail toward the sandbox, never accidentally take live payments. */
function dodoApiBase(env: Env): string {
  return env.DODO_MODE === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';
}

billingRoute.post('/v1/billing/checkout', apiKeyAuth, async (c) => {
  const body = await c.req.json<CreateCheckoutRequest>().catch(() => null);
  if (!body || (body.plan !== 'monthly' && body.plan !== 'yearly')) {
    return c.json({ error: 'Body must include plan: "monthly" | "yearly"' }, 400);
  }
  const productId = body.plan === 'yearly' ? c.env.DODO_PRODUCT_ID_YEARLY : c.env.DODO_PRODUCT_ID_MONTHLY;

  const db = getSupabase(c.env);
  const userId = c.get('userId');
  const user = await getUserById(db, userId);
  if (!user) return c.json({ error: 'User not found' }, 404);

  const origin = new URL(c.req.url).origin;
  const dodoResponse = await fetch(`${dodoApiBase(c.env)}/checkouts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.DODO_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: user.email ? { email: user.email } : undefined,
      // Read back in the webhook handler to resolve which MailTrack account
      // this subscription belongs to — Dodo has no other shared identifier.
      metadata: { mailtrack_user_id: userId },
      return_url: `${origin}/billing/success`,
    }),
  });
  if (!dodoResponse.ok) {
    console.error('[billing/checkout] Dodo checkout creation failed:', dodoResponse.status, await dodoResponse.text().catch(() => ''));
    return c.json({ error: 'Could not create checkout session' }, 502);
  }
  const session = await dodoResponse.json<{ checkout_url: string }>();
  const response: CreateCheckoutResponse = { checkoutUrl: session.checkout_url };
  return c.json(response);
});

billingRoute.get('/v1/billing/status', apiKeyAuth, async (c) => {
  const db = getSupabase(c.env);
  const response: BillingStatusResponse = { active: await hasActiveSubscription(db, c.get('userId')) };
  return c.json(response);
});

/**
 * ADR-44. A free-lifetime grant (`free_lifetime_<userId>`, see
 * grantLifetimeSubscription) was never created at Dodo, so cancelling one
 * is purely local — calling Dodo's cancel API with a subscription id it's
 * never heard of would just 404. A real Dodo subscription is cancelled via
 * their documented `cancel_at_next_billing_date` flag (PATCH
 * /subscriptions/{id}, confirmed against Dodo's own API reference), which
 * schedules cancellation for the end of the current billing period rather
 * than revoking access the customer already paid for.
 */
billingRoute.post('/v1/billing/cancel', apiKeyAuth, async (c) => {
  const db = getSupabase(c.env);
  const userId = c.get('userId');
  const subscription = await getActiveSubscriptionForUser(db, userId);
  if (!subscription) return c.json({ error: 'No active subscription to cancel' }, 404);

  if (subscription.dodoSubscriptionId.startsWith(LIFETIME_GRANT_PREFIX)) {
    await markSubscriptionStatus(db, subscription.dodoSubscriptionId, 'cancelled');
    const response: CancelSubscriptionResponse = { cancelled: true, message: 'Your free access has been cancelled.' };
    return c.json(response);
  }

  const dodoResponse = await fetch(`${dodoApiBase(c.env)}/subscriptions/${subscription.dodoSubscriptionId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${c.env.DODO_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cancel_at_next_billing_date: true, cancel_reason: 'cancelled_by_customer' }),
  });
  if (!dodoResponse.ok) {
    console.error('[billing/cancel] Dodo cancellation failed:', dodoResponse.status, await dodoResponse.text().catch(() => ''));
    return c.json({ error: 'Could not cancel subscription' }, 502);
  }
  // Deliberately NOT flipping local status to 'cancelled' here — the
  // subscription is still active until the billing period actually ends,
  // and Dodo's own subscription.cancelled webhook (already handled below)
  // is the source of truth for when that happens, same as every other
  // subscription state change in this file.
  const response: CancelSubscriptionResponse = { cancelled: true, message: 'Your subscription will end at the close of the current billing period.' };
  return c.json(response);
});

/**
 * ADR-44. One-time internal action: grants every existing account (as of
 * whenever this is called) a free, non-expiring subscription so nobody who
 * was already using MailTrack loses tracking access now that ADR-37
 * switched billing to live mode. Gated on a shared secret header, not
 * apiKeyAuth — this isn't a per-user action, it iterates every user.
 * Idempotent: users who already have an active subscription (paid or a
 * prior grant) are skipped, not overwritten.
 */
billingRoute.post('/v1/admin/grant-lifetime-subscriptions', async (c) => {
  const providedSecret = c.req.header('X-Admin-Secret');
  if (!providedSecret || providedSecret !== c.env.ADMIN_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const db = getSupabase(c.env);
  const userIds = await getAllUserIds(db);
  let granted = 0;
  for (const userId of userIds) {
    if (await hasActiveSubscription(db, userId)) continue;
    await grantLifetimeSubscription(db, userId);
    granted++;
  }
  return c.json({ totalUsers: userIds.length, granted });
});

/** ADR-44. Same auth pattern as the grant action above — one-time cleanup for accounts given a placeholder subscription before live billing existed. See normalizeLegacyPlaceholderSubscriptions. */
billingRoute.post('/v1/admin/normalize-legacy-subscriptions', async (c) => {
  const providedSecret = c.req.header('X-Admin-Secret');
  if (!providedSecret || providedSecret !== c.env.ADMIN_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const db = getSupabase(c.env);
  const normalized = await normalizeLegacyPlaceholderSubscriptions(db);
  return c.json({ normalized });
});

billingRoute.get('/billing/success', (c) => c.html(SUCCESS_HTML));
billingRoute.get('/billing/cancel', (c) => c.html(CANCEL_HTML));

/**
 * Source of truth for subscription state. Dodo's own docs are explicit that
 * inline-checkout client-side events must never be trusted alone for
 * payment confirmation — this signature-verified webhook is the only writer
 * to the subscriptions table (see db/client.ts upsertSubscription).
 */
billingRoute.post('/v1/webhooks/dodo', async (c) => {
  const rawBody = await c.req.text();
  const id = c.req.header('webhook-id');
  const timestamp = c.req.header('webhook-timestamp');
  const signature = c.req.header('webhook-signature');
  if (!id || !timestamp || !signature) return c.json({ error: 'Missing webhook signature headers' }, 400);

  const valid = await verifyDodoWebhook(rawBody, { id, timestamp, signature }, c.env.DODO_WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  if (!valid) return c.json({ error: 'Invalid signature' }, 401);

  let event: DodoWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const db = getSupabase(c.env);
  const subscriptionId = event.data.subscription_id;
  const userId = typeof event.data.metadata?.mailtrack_user_id === 'string' ? event.data.metadata.mailtrack_user_id : null;

  if ((event.type === 'subscription.active' || event.type === 'subscription.renewed') && subscriptionId && userId) {
    await upsertSubscription(db, {
      userId,
      dodoSubscriptionId: subscriptionId,
      status: 'active',
      currentPeriodEnd: event.data.current_period_end ?? null,
    });
  } else if (subscriptionId) {
    const inactiveStatus = INACTIVE_STATUS_BY_EVENT[event.type];
    if (inactiveStatus) await markSubscriptionStatus(db, subscriptionId, inactiveStatus);
  }

  return c.json({ received: true });
});

interface DodoWebhookEvent {
  type: string;
  data: {
    payload_type?: string;
    subscription_id?: string;
    metadata?: Record<string, unknown>;
    current_period_end?: string;
  };
}

// A failed payment isn't necessarily a permanent cancellation (Dodo retries)
// — mapped to 'past_due' rather than 'cancelled' so a subsequent
// subscription.renewed can cleanly restore 'active'.
const INACTIVE_STATUS_BY_EVENT: Record<string, Exclude<SubscriptionStatus, 'active'> | undefined> = {
  'subscription.cancelled': 'cancelled',
  'subscription.failed': 'past_due',
  'subscription.expired': 'expired',
};

const SUCCESS_HTML = `<!doctype html><html><body style="font-family:system-ui,sans-serif;text-align:center;padding:4rem 1.5rem"><h1>You're subscribed 🎉</h1><p>You can close this tab and return to Gmail — MailTrack will start tracking your next sent email.</p></body></html>`;
const CANCEL_HTML = `<!doctype html><html><body style="font-family:system-ui,sans-serif;text-align:center;padding:4rem 1.5rem"><h1>Checkout cancelled</h1><p>No charge was made. You can close this tab.</p></body></html>`;
