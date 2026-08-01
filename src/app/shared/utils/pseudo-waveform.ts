/**
 * Deterministic, seeded "fake" waveform — same seed always produces the same
 * bars, so a given voice message doesn't visually jitter between renders.
 *
 * This is NOT derived from real audio samples (the client would have to
 * fetch + decode the whole remote file to do that, which is wasteful for a
 * bar in a chat list). If/when the upload pipeline stores real peaks
 * server-side (see audio duration extraction work), swap this out for
 * `attachment.waveform` and drop this file.
 */
export function pseudoWaveform(seed: string, bars = 28): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ seed.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619);
  }

  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    // clamp to 0.2–1 so no bar renders as an invisible sliver
    out.push(0.2 + ((h >>> 8) % 1000) / 1000 / 1.25);
  }
  return out;
}
