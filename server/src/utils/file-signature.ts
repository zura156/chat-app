/*
 * Whether a `dm-file` upload's first bytes fit the type it was declared as.
 *
 * `dm-file` is the one context stored byte for byte, and the type a client
 * declares at presign is only a claim. A table of leading bytes per type, with
 * no new dependency (SECURITY-FIXES.md 2.3b). It is not a parser: a file that
 * starts right can still be anything after that. The server-set headers on the
 * stored object (2.3c) are what make a lying file harmless; this check turns the
 * cheap lies away.
 */

/** How much of the file the check reads. */
export const SIGNATURE_SAMPLE_BYTES = 4096;

type Check = (bytes: Uint8Array) => boolean;

const startsWith =
  (...prefix: number[]): Check =>
  (bytes) =>
    bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

const ole2 = startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const zip = startsWith(0x50, 0x4b, 0x03, 0x04);
const sevenZip = startsWith(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c);
const rar = startsWith(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07);

// PDF readers accept the header anywhere in the first 1024 bytes, after junk.
const pdf: Check = (bytes) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 1024))
    .includes('%PDF-');

// UTF-8 with no NUL byte. `stream: true` keeps a multi-byte character cut off
// at the end of the sample from counting as invalid: the sample stops at 4 KiB,
// not at a character boundary. This turns away UTF-16 and Windows-1252 text,
// which the stored `charset=utf-8` would misrender anyway.
const utf8Text: Check = (bytes) => {
  if (bytes.length === 0 || bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
};

// Keyed by the types `CONTEXT_CONFIG['dm-file'].allowedMimes` accepts; the spec
// fails when one of those has no entry here.
const SIGNATURES = new Map<string, Check>([
  ['application/pdf', pdf],
  ['application/msword', ole2],
  ['application/vnd.ms-excel', ole2],
  ['application/vnd.ms-powerpoint', ole2],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    zip,
  ],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip],
  [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip,
  ],
  ['application/zip', zip],
  ['application/x-7z-compressed', sevenZip],
  ['application/x-rar-compressed', rar],
  ['text/plain', utf8Text],
  ['text/csv', utf8Text],
]);

export const hasSignature = (mimeType: string): boolean =>
  SIGNATURES.has(mimeType);

/** False for an empty sample, and for any type the table doesn't know. */
export const matchesDeclaredType = (
  mimeType: string,
  firstBytes: Uint8Array,
): boolean => SIGNATURES.get(mimeType)?.(firstBytes) ?? false;
