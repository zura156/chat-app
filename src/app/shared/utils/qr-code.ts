import qrcode from 'qrcode-generator';

/**
 * Encodes a string as QR modules and flattens them into a single SVG path.
 *
 * Rendering as a path rather than a canvas keeps this a pure function: no
 * element ref, no lifecycle hook, no re-draw on theme change — the template
 * binds the result and the browser scales it for free.
 *
 * `qrcode-generator` is used rather than the more common `qrcode` package
 * because it carries no transitive dependencies. The thing being encoded here
 * is a TOTP secret, and the reasoning in the server's totp.service.ts about not
 * widening the trust surface around the second factor applies on this side too.
 */

/**
 * Blank modules required around the symbol. Four is the spec's minimum; without
 * it scanners struggle to find the symbol against a busy background.
 */
const QUIET_ZONE = 4;

export interface QrCode {
  /** Path data covering every dark module. */
  readonly path: string;
  /** Width and height in modules, quiet zone included — use as the viewBox. */
  readonly extent: number;
}

export function encodeQr(
  data: string,
  correctionLevel: 'L' | 'M' | 'Q' | 'H' = 'M',
): QrCode {
  // Type number 0 picks the smallest symbol version the data fits into.
  const qr = qrcode(0, correctionLevel);
  qr.addData(data);
  qr.make();

  const count = qr.getModuleCount();
  let path = '';

  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }

      // Merge each horizontal run into one rect. Emitting a rect per module
      // works, but on a typical otpauth URI it triples the path length.
      const start = col;
      while (col < count && qr.isDark(row, col)) col++;

      const run = col - start;
      path += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`;
    }
  }

  return { path, extent: count + QUIET_ZONE * 2 };
}
