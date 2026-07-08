import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Weekly intel refresh (wrangler.toml cron: Monday 03:00 UTC).
 *
 * Apple Private Relay egress ranges: Apple publishes an authoritative CSV of
 * every egress IP range at mask-api.icloud.com (verified reachable, returns
 * several MB of CIDR rows — this is the same source other privacy/anti-fraud
 * tooling uses to detect Private Relay traffic). This is the IP-range side
 * of ADR-8.
 *
 * Security-scanner ASNs (Proofpoint/Mimecast/Barracuda/etc): there is no
 * equivalent single authoritative public feed, and shipping guessed ASN
 * numbers here would risk the exact failure mode this product exists to
 * prevent — a wrong number silently suppresses real opens. `asn_intel` rows
 * for scanners must be entered from verified vendor documentation (or a
 * licensed MaxMind feed, deferred — see PLAN.md Known Issues) rather than
 * fabricated. `upsertAsnIntel` below is the write path for when that data
 * is sourced; no seed data ships until it's verified.
 */

const APPLE_EGRESS_RANGES_URL = 'https://mask-api.icloud.com/egress-ip-ranges.csv';
const UPSERT_BATCH_SIZE = 500;

export async function refreshAppleRelayRanges(db: SupabaseClient): Promise<{ ranges: number }> {
  const response = await fetch(APPLE_EGRESS_RANGES_URL);
  if (!response.ok) {
    throw new Error(`Apple egress-range fetch failed: ${response.status}`);
  }

  const text = await response.text();
  const cidrs = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(',')[0]?.trim()) // format is `cidr[,region,...]`; we only use the CIDR
    .filter((cidr): cidr is string => !!cidr && cidr.includes('/'));

  for (let i = 0; i < cidrs.length; i += UPSERT_BATCH_SIZE) {
    const batch = cidrs.slice(i, i + UPSERT_BATCH_SIZE).map((cidr) => ({
      cidr,
      category: 'apple_mpp' as const,
      source: 'apple-egress-ip-ranges',
      updated_at: new Date().toISOString(),
    }));
    const { error } = await db.from('ip_ranges').upsert(batch, { onConflict: 'cidr' });
    if (error) throw error;
  }

  return { ranges: cidrs.length };
}

export async function upsertAsnIntel(
  db: SupabaseClient,
  entries: { asn: number; orgName: string; category: 'security_scanner' | 'apple_mpp' | 'datacenter_other' }[],
): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await db.from('asn_intel').upsert(
    entries.map((e) => ({ asn: e.asn, org_name: e.orgName, category: e.category, updated_at: new Date().toISOString() })),
    { onConflict: 'asn' },
  );
  if (error) throw error;
}
