/**
 * Pure, DOM-free string transforms for injecting tracking into a compose
 * body's HTML. Regex-based rather than DOMParser-based deliberately: it
 * keeps these functions unit-testable under plain vitest (no jsdom) and
 * Gmail compose bodies are simple enough HTML that attribute-level regex is
 * reliable and cheap — no need for a full parse/serialize round-trip that
 * risks reformatting the user's message.
 */

const HREF_ATTR = /href=(["'])(https?:\/\/[^"']+)\1/g;

/** Every distinct http(s) link URL in the compose body, in first-seen order. */
export function extractLinkUrls(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(HREF_ATTR)) {
    const url = match[2];
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
