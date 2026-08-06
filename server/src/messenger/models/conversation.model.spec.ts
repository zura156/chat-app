import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { buildDmKey } from './conversation.model';

/*
 * `dm_key` is the whole of the "no duplicate DMs" guarantee — the unique index
 * is on this string, so a key that is not order-independent silently allows two
 * conversations between the same pair, one per direction. Nothing else notices:
 * both are valid documents, and each user simply sees whichever they created.
 *
 * (The index itself is exercised in conversation.model.int.spec.ts, which needs
 * a real MongoDB. This is just the key derivation.)
 */

describe('buildDmKey', () => {
  const a = new Types.ObjectId();
  const b = new Types.ObjectId();
  const c = new Types.ObjectId();

  it('is order-independent', () => {
    expect(buildDmKey([a, b])).toBe(buildDmKey([b, a]));
  });

  it('treats an id and its string form as the same participant', () => {
    // Callers pass both: `createConversation` normalises to strings, the model
    // holds ObjectIds.
    expect(buildDmKey([a.toString(), b])).toBe(buildDmKey([b, a.toString()]));
    expect(buildDmKey([a, b])).toBe(buildDmKey([a.toString(), b.toString()]));
  });

  it('distinguishes different pairs', () => {
    expect(buildDmKey([a, b])).not.toBe(buildDmKey([a, c]));
    expect(buildDmKey([a, b])).not.toBe(buildDmKey([b, c]));
  });

  it('is a plain colon-joined pair of sorted hex ids', () => {
    const [first, second] = [a.toString(), b.toString()].sort();
    expect(buildDmKey([b, a])).toBe(`${first}:${second}`);
  });
});
