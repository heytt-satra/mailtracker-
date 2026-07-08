/**
 * Cloudflare terminates every request at the edge and already knows the
 * requesting IP's ASN — it's on `request.cf.asn` / `request.cf.asOrganization`,
 * no GeoIP database lookup needed in the hot path. This is an improvement
 * over the original plan (MaxMind GeoLite2-ASN for IP->ASN resolution):
 * MaxMind + published ranges are now used ONLY to build the asn_intel
 * category mapping (asn -> apple_mpp/security_scanner/...), not to resolve
 * an IP to an ASN in the first place. See PLAN.md ADR-6.
 */
export interface RequestAsn {
  asn: number | null;
  orgName: string | null;
}

export function getRequestAsn(request: Request): RequestAsn {
  const cf = (request as Request & { cf?: IncomingRequestCfProperties }).cf;
  return {
    asn: cf?.asn ?? null,
    orgName: cf?.asOrganization ?? null,
  };
}
