import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import { getSupabase, getUserByApiKeyHash } from '../db/client';
import { sha256Hex } from '../lib/crypto';

/** Per-install API key auth. Keys are never stored in plaintext (security checklist item). */
export async function apiKeyAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const header = c.req.header('Authorization');
  const apiKey = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!apiKey) {
    return c.json({ error: 'Missing API key' }, 401);
  }

  const db = getSupabase(c.env);
  const hash = await sha256Hex(apiKey);
  const user = await getUserByApiKeyHash(db, hash);
  if (!user) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  c.set('userId', user.id);
  await next();
}
