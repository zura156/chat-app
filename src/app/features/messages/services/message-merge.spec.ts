import { describe, expect, it } from 'vitest';
import { byNewestFirst, mergeMessagePage } from './message.service';
import { MessageI } from '../interfaces/message.interface';

/*
 * Folding a fetched page of history into the thread already on screen.
 *
 * This is the piece of the message list that was order-dependent: it relied on
 * pages arriving strictly oldest-last and on new messages always being
 * prepended. That holds on the happy path and stops holding the moment anything
 * arrives out of order — a websocket redelivery after a reconnect, or a message
 * landing while an older page is still in flight. The thread then stayed
 * scrambled for the rest of the session, and the date dividers, which read the
 * list assuming descending order, were drawn in the wrong places.
 *
 * The other half of its job is identity. A message the current user sent exists
 * on screen as an optimistic bubble with only a `tempId`, and comes back from
 * the server with only an `_id` — so what counts as "the same message" changes
 * depending on how far through that handshake it is.
 */

const at = (iso: string, over: Partial<MessageI> = {}): MessageI =>
  ({
    _id: over._id,
    tempId: over.tempId,
    conversation: 'c1',
    content: over.content ?? iso,
    timestamp: iso,
    ...over,
  }) as MessageI;

const contents = (messages: MessageI[]) => messages.map((m) => m.content);

describe('byNewestFirst', () => {
  it('puts the newest first', () => {
    const older = at('2026-01-01T10:00:00Z');
    const newer = at('2026-01-01T11:00:00Z');
    expect([older, newer].sort(byNewestFirst)).toEqual([newer, older]);
  });

  it('is stable for identical timestamps', () => {
    // Two messages in the same millisecond must not swap places on every merge,
    // which would make the thread twitch as pages load.
    const a = at('2026-01-01T10:00:00Z', { _id: 'a' });
    const b = at('2026-01-01T10:00:00Z', { _id: 'b' });
    expect([a, b].sort(byNewestFirst).map((m) => m._id)).toEqual(['a', 'b']);
  });
});

describe('mergeMessagePage', () => {
  describe('ordering', () => {
    it('returns a page newest-first', () => {
      const merged = mergeMessagePage(
        [],
        [
          at('2026-01-01T10:00:00Z', { _id: '1', content: 'oldest' }),
          at('2026-01-01T12:00:00Z', { _id: '3', content: 'newest' }),
          at('2026-01-01T11:00:00Z', { _id: '2', content: 'middle' }),
        ],
      );

      expect(contents(merged)).toEqual(['newest', 'middle', 'oldest']);
    });

    it('sorts a page that arrives out of order into the existing thread', () => {
      /*
       * The regression. Concatenating would leave the older page below the
       * newer one only because it happened to arrive second; here the incoming
       * page is deliberately not contiguous with what is on screen.
       */
      const onScreen = [
        at('2026-01-01T12:00:00Z', { _id: '3', content: 'c' }),
        at('2026-01-01T10:00:00Z', { _id: '1', content: 'a' }),
      ];
      const page = [at('2026-01-01T11:00:00Z', { _id: '2', content: 'b' })];

      expect(contents(mergeMessagePage(onScreen, page))).toEqual([
        'c',
        'b',
        'a',
      ]);
    });

    it('places a message newer than everything on screen at the top', () => {
      const onScreen = [at('2026-01-01T10:00:00Z', { _id: '1', content: 'a' })];
      const live = [at('2026-01-01T13:00:00Z', { _id: '9', content: 'live' })];

      expect(contents(mergeMessagePage(onScreen, live))[0]).toBe('live');
    });
  });

  describe('identity', () => {
    it('does not duplicate a message already on screen', () => {
      const existing = at('2026-01-01T10:00:00Z', { _id: '1' });
      const merged = mergeMessagePage([existing], [existing]);
      expect(merged).toHaveLength(1);
    });

    it('lets the fetched copy win, so edits and signatures refresh', () => {
      /*
       * Attachment URLs are presigned with a fixed lifetime and an edited
       * message comes back with new content — a merge that preferred what was
       * already on screen would pin both to whatever was first seen.
       */
      const stale = at('2026-01-01T10:00:00Z', { _id: '1', content: 'before' });
      const fresh = at('2026-01-01T10:00:00Z', { _id: '1', content: 'after' });

      expect(contents(mergeMessagePage([stale], [fresh]))).toEqual(['after']);
    });

    it('keeps an optimistic message that has no server id yet', () => {
      // It is on screen because the user just sent it; a page load must not
      // make their own message vanish while it is still in flight.
      const pending = at('2026-01-01T12:00:00Z', {
        tempId: 't1',
        content: 'sending',
      });
      const page = [at('2026-01-01T10:00:00Z', { _id: '1', content: 'old' })];

      expect(contents(mergeMessagePage([pending], page))).toEqual([
        'sending',
        'old',
      ]);
    });

    it('treats a reconciled message as one entry, by its server id', () => {
      // Once acknowledged an entry carries both ids. Keyed by `_id`, so the
      // fetched copy of the same message collapses onto it.
      const reconciled = at('2026-01-01T12:00:00Z', {
        _id: '5',
        tempId: 't1',
        content: 'sent',
      });
      const fetched = at('2026-01-01T12:00:00Z', { _id: '5', content: 'sent' });

      expect(mergeMessagePage([reconciled], [fetched])).toHaveLength(1);
    });

    it('drops anything with no identity at all', () => {
      // Nothing can be matched against it later, so keeping it would mean a
      // bubble that duplicates on every subsequent page.
      const anonymous = at('2026-01-01T10:00:00Z');
      expect(mergeMessagePage([], [anonymous])).toEqual([]);
    });

    it('keeps distinct optimistic messages apart', () => {
      const first = at('2026-01-01T12:00:00Z', { tempId: 't1', content: '1' });
      const second = at('2026-01-01T12:00:01Z', { tempId: 't2', content: '2' });

      expect(mergeMessagePage([first], [second])).toHaveLength(2);
    });
  });

  describe('degenerate input', () => {
    it('handles an empty page', () => {
      const existing = [at('2026-01-01T10:00:00Z', { _id: '1' })];
      expect(mergeMessagePage(existing, [])).toHaveLength(1);
    });

    it('handles an empty thread', () => {
      const page = [at('2026-01-01T10:00:00Z', { _id: '1' })];
      expect(mergeMessagePage([], page)).toHaveLength(1);
    });

    it('handles both empty', () => {
      expect(mergeMessagePage([], [])).toEqual([]);
    });

    it('does not mutate either input', () => {
      // Both are signal values elsewhere; sorting one in place would be a
      // write nothing scheduled.
      const previous = [
        at('2026-01-01T10:00:00Z', { _id: '1' }),
        at('2026-01-01T12:00:00Z', { _id: '2' }),
      ];
      const incoming = [at('2026-01-01T11:00:00Z', { _id: '3' })];
      const previousOrder = previous.map((m) => m._id);
      const incomingOrder = incoming.map((m) => m._id);

      mergeMessagePage(previous, incoming);

      expect(previous.map((m) => m._id)).toEqual(previousOrder);
      expect(incoming.map((m) => m._id)).toEqual(incomingOrder);
    });
  });
});
