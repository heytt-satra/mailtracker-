import { describe, expect, it } from 'vitest';
import { appendTrackingPixel, extractLinkUrls, rewriteLinks } from '../src/html-injection';

describe('extractLinkUrls', () => {
  it('finds http(s) links and dedupes', () => {
    const html = `<a href="https://example.com/a">A</a><a href='https://example.com/b'>B</a><a href="https://example.com/a">A again</a>`;
    expect(extractLinkUrls(html)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('ignores mailto: and relative links', () => {
    const html = `<a href="mailto:x@y.com">mail</a><a href="/relative">rel</a>`;
    expect(extractLinkUrls(html)).toEqual([]);
  });

  it('returns empty array for plain text with no links', () => {
    expect(extractLinkUrls('<p>hello world</p>')).toEqual([]);
  });
});

describe('rewriteLinks', () => {
  it('replaces mapped hrefs and preserves quote style', () => {
    const html = `<a href="https://example.com/a">A</a><a href='https://example.com/b'>B</a>`;
    const result = rewriteLinks(html, {
      'https://example.com/a': 'https://api.mailtrack.dev/l/tok1',
      'https://example.com/b': 'https://api.mailtrack.dev/l/tok2',
    });
    expect(result).toContain('href="https://api.mailtrack.dev/l/tok1"');
    expect(result).toContain(`href='https://api.mailtrack.dev/l/tok2'`);
  });

  it('leaves unmapped links untouched', () => {
    const html = `<a href="https://untracked.example.com">x</a>`;
    expect(rewriteLinks(html, {})).toBe(html);
  });
});

describe('appendTrackingPixel', () => {
  it('appends a 1x1 image with the given pixel URL and no watermark text', () => {
    const result = appendTrackingPixel('<p>hi</p>', 'https://api.mailtrack.dev/p/abc.gif');
    expect(result).toContain('<p>hi</p>');
    expect(result).toContain('src="https://api.mailtrack.dev/p/abc.gif"');
    expect(result).toContain('width="1"');
    expect(result).toContain('height="1"');
    expect(result).not.toMatch(/display:\s*none/);
    // No visible branding text appended (a URL inside the invisible pixel's
    // src is fine — that's not visible to the recipient; visible watermark
    // text like "Sent with MailTrack" is what FR2 forbids).
    expect(result).not.toMatch(/sent with/i);
    expect(result).not.toMatch(/>[^<]*mailtrack[^<]*</i);
  });
});
