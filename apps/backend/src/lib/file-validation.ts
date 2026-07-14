/**
 * ADR-46 (file upload safety). Content-Type is a client-declared header —
 * trivially spoofable, never proof of what the bytes actually are. This
 * checks the real PDF magic signature (`%PDF-`, the first 5 bytes of every
 * valid PDF per the ISO 32000 spec) so a file that merely CLAIMS to be a
 * PDF via its header, but isn't one, gets rejected before it's ever stored
 * or served back with a `Content-Type: application/pdf` header a browser
 * or PDF reader would trust.
 */
const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function isPdfMagicBytes(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < PDF_MAGIC_BYTES.length) return false;
  const bytes = new Uint8Array(buffer, 0, PDF_MAGIC_BYTES.length);
  return PDF_MAGIC_BYTES.every((expected, i) => bytes[i] === expected);
}
