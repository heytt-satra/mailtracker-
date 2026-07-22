/**
 * Pure, DOM-free string transforms for injecting tracking into a compose
 * body's HTML. Regex-based rather than DOMParser-based deliberately: it
 * keeps these functions unit-testable under plain vitest (no jsdom) and
 * mail compose bodies are simple enough HTML that attribute-level regex is
 * reliable and cheap — no need for a full parse/serialize round-trip that
 * risks reformatting the user's message.
 *
 * ADR-61 (Outlook add-in, C2). Copied verbatim from
 * apps/extension/src/html-injection.ts — this file has zero imports and no
 * chrome/InboxSDK dependency, so it's identical for both clients. Kept as a
 * copy rather than extracted into packages/shared for now (see PLAN.md/ADR-61):
 * revisit only if a third consumer ever needs it.
 */

const HREF_ATTR = /href=(["'])(https?:\/\/[^"']+)\1/g;

/** Every distinct http(s) link URL in the compose body, in first-seen order. */
export function extractLinkUrls(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(HREF_ATTR)) {
    // Both capture groups are always present on a successful match — HREF_ATTR has no optional groups.
    const url = match[2]!;
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

/** Replaces each href with its tracked redirect URL from linkMap. Links not in the map are left untouched. */
export function rewriteLinks(html: string, linkMap: Record<string, string>): string {
  return html.replace(HREF_ATTR, (full, quote, url) => {
    const tracked = linkMap[url];
    return tracked ? `href=${quote}${tracked}${quote}` : full;
  });
}

/**
 * Appends the invisible tracking pixel. No watermark text, no branding —
 * just the pixel (FR2). Deliberately NOT display:none — some mail clients'
 * privacy heuristics specifically detect and skip fetching hidden images,
 * which would break tracking outright rather than just misclassify it. A
 * plain 1x1 image is invisible by size alone and fetches like any other
 * inline image.
 */
export function appendTrackingPixel(html: string, pixelUrl: string): string {
  const img = `<img src="${pixelUrl}" width="1" height="1" alt="" border="0" />`;
  return `${html}${img}`;
}

/**
 * Track B depth beacons (ADR-19). Only called for messages already past
 * LONG_MESSAGE_BEACON_THRESHOLD_BYTES (see routes/messages.ts) — the mid
 * beacon is inserted roughly halfway through the body, the bottom beacon at
 * the very end, same invisible-1x1-image approach as appendTrackingPixel.
 * The mid insertion point is snapped forward to the next `>` at or after the
 * body's midpoint rather than a raw character split, so it can never land
 * inside an existing tag's attributes and corrupt the markup; falls back to
 * appending at the end if no `>` exists past the midpoint (a body too short
 * to have realistically triggered the length gate in the first place).
 */
export function appendDepthBeacons(html: string, beaconUrls: { mid: string; bottom: string }): string {
  const midImg = `<img src="${beaconUrls.mid}" width="1" height="1" alt="" border="0" />`;
  const bottomImg = `<img src="${beaconUrls.bottom}" width="1" height="1" alt="" border="0" />`;

  const midpoint = Math.floor(html.length / 2);
  const insertAt = html.indexOf('>', midpoint);
  const withMid = insertAt === -1 ? `${html}${midImg}` : `${html.slice(0, insertAt + 1)}${midImg}${html.slice(insertAt + 1)}`;

  return `${withMid}${bottomImg}`;
}
