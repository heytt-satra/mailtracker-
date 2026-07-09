import { describe, expect, it } from 'vitest';
import { appendDepthBeacons, appendTrackingPixel, extractLinkUrls, rewriteLinks } from '../src/html-injection';

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

describe('appendDepthBeacons', () => {
  it('inserts both beacon images and preserves all original content', () => {
    const html = '<p>Paragraph one.</p><p>Paragraph two.</p><p>Paragraph three.</p>';
    const result = appendDepthBeacons(html, { mid: 'https://api.mailtrack.dev/b/mid1.gif', bottom: 'https://api.mailtrack.dev/b/bottom1.gif' });
    expect(result).toContain('Paragraph one.');
    expect(result).toContain('Paragraph two.');
    expect(result).toContain('Paragraph three.');
    expect(result).toContain('src="https://api.mailtrack.dev/b/mid1.gif"');
    expect(result).toContain('src="https://api.mailtrack.dev/b/bottom1.gif"');
  });

  it('places the mid beacon before the bottom beacon in document order', () => {
    const html = '<p>' + 'x'.repeat(200) + '</p><p>' + 'y'.repeat(200) + '</p>';
    const result = appendDepthBeacons(html, { mid: 'https://api.mailtrack.dev/b/mid1.gif', bottom: 'https://api.mailtrack.dev/b/bottom1.gif' });
    expect(result.indexOf('mid1.gif')).toBeLessThan(result.indexOf('bottom1.gif'));
  });

  it('never splits inside an existing tag — the mid image always lands right after a closing >', () => {
    const html = '<p>' + 'a'.repeat(500) + '</p><a href="https://example.com/very/long/path/that/would/straddle/the/midpoint">link text</a>';
    const result = appendDepthBeacons(html, { mid: 'https://api.mailtrack.dev/b/mid1.gif', bottom: 'https://api.mailtrack.dev/b/bottom1.gif' });
    expect(result).toContain('<a href="https://example.com/very/long/path/that/would/straddle/the/midpoint">link text</a>');
    expect(result).not.toMatch(/href="[^"]*<img/); // the mid <img> tag must never end up inside an href attribute
  });

  it('falls back to appending both at the end for a body too short to have a > past the midpoint', () => {
    const html = 'plain text no tags';
    const result = appendDepthBeacons(html, { mid: 'https://api.mailtrack.dev/b/mid1.gif', bottom: 'https://api.mailtrack.dev/b/bottom1.gif' });
    expect(result.startsWith(html)).toBe(true);
    expect(result).toContain('mid1.gif');
    expect(result).toContain('bottom1.gif');
  });
});
