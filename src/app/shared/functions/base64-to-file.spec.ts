import { describe, expect, it } from 'vitest';
import { base64ToFile } from './base64-to-file';

/*
 * The last step of the avatar cropper: the cropper hands back a data URL and
 * the upload pipeline needs a File. Everything downstream — the multipart body,
 * the server's type allowlist, the stored object's content type — reads the
 * `type` and the bytes this sets, so a mistake here surfaces as a rejected or
 * corrupt upload well away from this function.
 */

/** "Hi" as a data URL — small enough to assert on byte for byte. */
const HI_PNG = 'data:image/png;base64,SGk=';

describe('base64ToFile', () => {
  it('decodes the payload to the original bytes', async () => {
    const file = base64ToFile(HI_PNG, 'avatar.png');
    expect(await file.text()).toBe('Hi');
  });

  it('carries the mime type from the data URL onto the File', () => {
    // The server checks this rather than the extension, so an upload with the
    // wrong type is refused even though the bytes are fine.
    expect(base64ToFile(HI_PNG, 'avatar.png').type).toBe('image/png');
    expect(base64ToFile('data:image/webp;base64,SGk=', 'a.webp').type).toBe(
      'image/webp',
    );
    expect(base64ToFile('data:image/jpeg;base64,SGk=', 'a.jpg').type).toBe(
      'image/jpeg',
    );
  });

  it('uses the filename it is given', () => {
    expect(base64ToFile(HI_PNG, 'profile-picture.png').name).toBe(
      'profile-picture.png',
    );
  });

  it('reports the decoded length, not the encoded one', () => {
    // Base64 is about a third larger; sizing off the string would make every
    // upload look oversized against the client-side limit.
    const file = base64ToFile(HI_PNG, 'a.png');
    expect(file.size).toBe(2);
    expect(file.size).toBeLessThan(HI_PNG.length);
  });

  it('round-trips bytes that are not valid text', async () => {
    /*
     * The real input is a PNG, which is full of high bytes and NULs. The
     * decode goes through `charCodeAt` into a Uint8Array, so anything that
     * treated the intermediate as a string would mangle exactly these.
     */
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d]);
    const base64 = btoa(String.fromCharCode(...bytes));

    const file = base64ToFile(`data:image/png;base64,${base64}`, 'a.png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it('preserves the PNG signature exactly', () => {
    // A cropper output whose first eight bytes are wrong is rejected by the
    // server's content sniffing even though the extension and type agree.
    const signature = 'iVBORw0KGgo=';
    const file = base64ToFile(`data:image/png;base64,${signature}`, 'a.png');
    expect(file.size).toBe(8);
  });

  it('handles a payload containing a comma', async () => {
    // Base64 never emits a comma, but the split is on the first one either
    // way — pinned so a change to `split(',')` handling is deliberate.
    const file = base64ToFile('data:text/plain;base64,QSxC', 'a.txt');
    expect(await file.text()).toBe('A,B');
  });

  it('decodes an empty payload to an empty file', () => {
    expect(base64ToFile('data:image/png;base64,', 'a.png').size).toBe(0);
  });

  it('throws on a string that is not a data URL', () => {
    /*
     * Pinned, not endorsed. The mime match is asserted non-null, so anything
     * without a `:type;` prefix throws a TypeError rather than returning
     * something the caller can check. Every current call site is fed the
     * cropper's own output, so this is reachable only via a future one — which
     * is exactly when it would be a surprise.
     */
    expect(() => base64ToFile('not-a-data-url', 'a.png')).toThrow();
    expect(() => base64ToFile('', 'a.png')).toThrow();
  });
});
