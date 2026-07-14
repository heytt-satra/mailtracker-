import { z } from 'zod';
import type { Context } from 'hono';
import type { ZodError, ZodType } from 'zod';
import type { Env, Variables } from '../types';

/**
 * Deliberately NOT zod's built-in `.datetime()` — that enforces strict
 * ISO-8601 grammar and would reject some values `new Date()` itself parses
 * fine. Every caller of this schema is the extension sending its own
 * `new Date().toISOString()` output, so this preserves the exact
 * "is this actually a parseable instant" check the routes already had,
 * just expressed as a reusable schema instead of duplicated per route.
 */
export const isoTimestamp = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'must be a valid ISO-8601 timestamp');

/**
 * Project-wide input-validation policy: reject malformed input outright
 * (400 with the specific field-level reason), never silently truncate or
 * substitute a default. Every route's request body/query is validated
 * through here against a strict Zod schema — see each route file for its
 * schema. `{ error, details }` matches the existing `{ error: string }`
 * shape everywhere else in this API, with `details` added for the
 * field-level breakdown a caller needs to fix their request.
 */
export interface ValidationOk<T> {
  ok: true;
  data: T;
}
export interface ValidationErr {
  ok: false;
  response: Response;
}
export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`);
}

/**
 * Parses and validates a JSON request body. A body that isn't valid JSON at
 * all is treated the same as one that fails schema validation — both are a
 * 400, not two different error shapes for what's functionally the same
 * "you sent me something I can't use" failure.
 */
export async function parseJsonBody<T>(c: Context<{ Bindings: Env; Variables: Variables }>, schema: ZodType<T>): Promise<ValidationResult<T>> {
  const raw = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: c.json({ error: 'Invalid request body', details: formatZodError(result.error) }, 400) };
  }
  return { ok: true, data: result.data };
}

/** Same contract as parseJsonBody, for query-string params (already-parsed plain object, e.g. from c.req.query()). */
export function parseQuery<T>(c: Context<{ Bindings: Env; Variables: Variables }>, schema: ZodType<T>, query: Record<string, string | undefined>): ValidationResult<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    return { ok: false, response: c.json({ error: 'Invalid query parameters', details: formatZodError(result.error) }, 400) };
  }
  return { ok: true, data: result.data };
}
