import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { CreateInviteResponse, CreateOrganizationResponse, GetOrganizationResponse, JoinOrganizationResponse, OrgMessagesResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import {
  buildMessageSummary,
  createOrgInvite,
  createOrganization,
  deleteOrganization,
  getOrgInviteByToken,
  getOrganizationForUser,
  getSupabase,
  getVerdictStatsForMessages,
  hasActiveSubscription,
  listMessagesForOrg,
  listOrganizationMembers,
  redeemOrgInvite,
  removeOrgMember,
} from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { randomToken } from '../lib/crypto';
import { checkRateLimit, ONE_MINUTE_MS, rateLimitedResponse, readRateLimitInt } from '../lib/rate-limit';
import { parseJsonBody, parseQuery } from '../lib/validate';

/**
 * ADR-60 (team accounts, C1). Shared visibility into teammates' tracked
 * sends, built entirely by joining organization_members against
 * messages.user_id at query time — no org_id column on messages, so this
 * feature can never affect the message-creation hot path (see db/client.ts's
 * ADR-60 section header for the full reasoning). Invites are short codes
 * shared out-of-band (no email-sending integration exists in this
 * codebase), not emailed links.
 */
export const organizationsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Same writes:${userId} bucket messages.ts/bounces.ts/replies.ts already share (ADR-45) — these are all low-volume, human-triggered actions, not a distinct cost driver worth its own bucket. */
async function checkOrgWriteRateLimit(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const limit = readRateLimitInt(c.env.RATE_LIMIT_WRITES_PER_MIN, 30);
  const { allowed, retryAfterSeconds } = await checkRateLimit(c.env, `writes:${c.get('userId')}`, { limit, windowMs: ONE_MINUTE_MS, backoff: false });
  return allowed ? null : rateLimitedResponse(c, retryAfterSeconds);
}

export const createOrgSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();

organizationsRoute.post('/v1/orgs', apiKeyAuth, async (c) => {
  const rateLimited = await checkOrgWriteRateLimit(c);
  if (rateLimited) return rateLimited;

  const userId = c.get('userId');
  const db = getSupabase(c.env);

  if (!(await hasActiveSubscription(db, userId))) {
    return c.json({ error: 'An active MailTrack subscription is required to create a team.' }, 402);
  }
  if (await getOrganizationForUser(db, userId)) {
    return c.json({ error: 'You are already in a team. Leave your current team before creating a new one.' }, 409);
  }

  const parsed = await parseJsonBody(c, createOrgSchema);
  if (!parsed.ok) return parsed.response;

  const org = await createOrganization(db, userId, parsed.data.name);
  const response: CreateOrganizationResponse = { organization: { id: org.id, name: org.name, role: 'owner' } };
  return c.json(response, 201);
});

organizationsRoute.get('/v1/orgs/me', apiKeyAuth, async (c) => {
  const db = getSupabase(c.env);
  const found = await getOrganizationForUser(db, c.get('userId'));
  if (!found) {
    const response: GetOrganizationResponse = { organization: null };
    return c.json(response);
  }

  const members = await listOrganizationMembers(db, found.organization.id);
  const response: GetOrganizationResponse = {
    organization: { id: found.organization.id, name: found.organization.name, role: found.role },
    members: members.map((m) => ({ email: m.email, role: m.role, joinedAt: m.joined_at })),
  };
  return c.json(response);
});

organizationsRoute.post('/v1/orgs/invite', apiKeyAuth, async (c) => {
  const rateLimited = await checkOrgWriteRateLimit(c);
  if (rateLimited) return rateLimited;

  const db = getSupabase(c.env);
  const found = await getOrganizationForUser(db, c.get('userId'));
  if (!found) return c.json({ error: 'You are not in a team.' }, 404);
  if (found.role !== 'owner') return c.json({ error: 'Only the team owner can invite members.' }, 403);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS).toISOString();
  await createOrgInvite(db, { orgId: found.organization.id, token, createdBy: c.get('userId'), expiresAt });

  const response: CreateInviteResponse = { code: token, expiresAt };
  return c.json(response, 201);
});

export const joinOrgSchema = z.object({ code: z.string().trim().min(1).max(200) }).strict();

organizationsRoute.post('/v1/orgs/join', apiKeyAuth, async (c) => {
  const rateLimited = await checkOrgWriteRateLimit(c);
  if (rateLimited) return rateLimited;

  const userId = c.get('userId');
  const db = getSupabase(c.env);

  if (await getOrganizationForUser(db, userId)) {
    return c.json({ error: 'You are already in a team. Leave your current team before joining another.' }, 409);
  }

  const parsed = await parseJsonBody(c, joinOrgSchema);
  if (!parsed.ok) return parsed.response;

  const invite = await getOrgInviteByToken(db, parsed.data.code);
  if (!invite) return c.json({ error: 'Invalid invite code.' }, 404);
  if (invite.used_at) return c.json({ error: 'This invite code has already been used.' }, 410);
  if (new Date(invite.expires_at).getTime() < Date.now()) return c.json({ error: 'This invite code has expired.' }, 410);

  await redeemOrgInvite(db, invite.id, invite.org_id, userId);

  const found = await getOrganizationForUser(db, userId);
  if (!found) return c.json({ error: 'Joined the team, but could not load it back. Try refreshing.' }, 500);
  const response: JoinOrganizationResponse = { organization: { id: found.organization.id, name: found.organization.name, role: found.role } };
  return c.json(response);
});

organizationsRoute.post('/v1/orgs/leave', apiKeyAuth, async (c) => {
  const rateLimited = await checkOrgWriteRateLimit(c);
  if (rateLimited) return rateLimited;

  const userId = c.get('userId');
  const db = getSupabase(c.env);
  const found = await getOrganizationForUser(db, userId);
  if (!found) return c.json({ error: 'You are not in a team.' }, 404);
  if (found.role === 'owner') {
    return c.json({ error: 'The owner cannot leave — delete the team instead if you want to disband it.' }, 409);
  }

  await removeOrgMember(db, found.organization.id, userId);
  return c.json({ left: true });
});

organizationsRoute.delete('/v1/orgs', apiKeyAuth, async (c) => {
  const rateLimited = await checkOrgWriteRateLimit(c);
  if (rateLimited) return rateLimited;

  const userId = c.get('userId');
  const db = getSupabase(c.env);
  const found = await getOrganizationForUser(db, userId);
  if (!found) return c.json({ error: 'You are not in a team.' }, 404);
  if (found.role !== 'owner') return c.json({ error: 'Only the team owner can delete the team.' }, 403);

  await deleteOrganization(db, found.organization.id);
  return c.json({ deleted: true });
});

const listOrgMessagesQuerySchema = z.object({ offset: z.coerce.number().int().nonnegative().optional() });

organizationsRoute.get('/v1/orgs/messages', apiKeyAuth, async (c) => {
  const parsedQuery = parseQuery(c, listOrgMessagesQuerySchema, { offset: c.req.query('offset') });
  if (!parsedQuery.ok) return parsedQuery.response;
  const offset = parsedQuery.data.offset ?? 0;

  const db = getSupabase(c.env);
  const found = await getOrganizationForUser(db, c.get('userId'));
  if (!found) return c.json({ error: 'You are not in a team.' }, 404);

  const members = await listOrganizationMembers(db, found.organization.id);
  const { rows, nextOffset } = await listMessagesForOrg(db, members.map((m) => m.user_id), offset);
  const stats = await getVerdictStatsForMessages(db, rows.map((row) => row.id));
  const response: OrgMessagesResponse = {
    messages: rows.map((row) => buildMessageSummary(row, stats.get(row.id))),
    nextOffset,
  };
  return c.json(response);
});
