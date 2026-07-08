import type { AsnIntel } from '@mailtrack/shared';

/**
 * ASN/IP intelligence filter. `asn_intel` is refreshed weekly (wrangler.toml
 * cron) from MaxMind GeoLite2-ASN plus published Apple/Microsoft/security-
 * vendor egress ranges. A null lookup means we have no data for that ASN yet
 * ('unknown' is NOT the same as 'residential_isp' — it must not be treated
 * as a human signal by itself).
 */

export function classifyAsn(asnIntel: AsnIntel | null): AsnIntel['category'] {
  return asnIntel?.category ?? 'unknown';
}
