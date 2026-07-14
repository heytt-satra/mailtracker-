import { describe, expect, it } from 'vitest';
import { isPdfMagicBytes } from '../src/lib/file-validation';

function bufferFrom(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe('isPdfMagicBytes', () => {
  it('accepts a buffer starting with the real PDF magic signature', () => {
    const pdfHeader = [...'%PDF-1.7'].map((c) => c.charCodeAt(0));
    expect(isPdfMagicBytes(bufferFrom(pdfHeader))).toBe(true);
  });

  it('rejects a file that merely has the right Content-Type claim but is actually something else (e.g. an HTML file)', () => {
    const htmlHeader = [...'<html><scr'].map((c) => c.charCodeAt(0));
    expect(isPdfMagicBytes(bufferFrom(htmlHeader))).toBe(false);
  });

  it('rejects an empty buffer without throwing', () => {
    expect(isPdfMagicBytes(bufferFrom([]))).toBe(false);
  });

  it('rejects a buffer shorter than the magic signature without throwing', () => {
    expect(isPdfMagicBytes(bufferFrom([0x25, 0x50]))).toBe(false);
  });

  it('rejects a plausible-looking but wrong byte sequence', () => {
    expect(isPdfMagicBytes(bufferFrom([0x25, 0x50, 0x44, 0x46, 0x00]))).toBe(false); // last byte should be '-' (0x2d)
  });
});
