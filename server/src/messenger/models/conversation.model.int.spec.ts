import { Types } from 'mongoose';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { describeIntegration, resetDatabase } from '../../test/env';
import { Conversation, buildDmKey, upsertReadReceipt } from './conversation.model';

/*
 * Read receipts and the DM uniqueness key, against a real database.
 *
 * Both are about concurrency and index behaviour, which is precisely the part
 * a mocked Mongoose cannot have an opinion about. The receipt writer in
 * particular exists because the previous update-then-push-then-catch-E11000
 * shape let two concurrent receipts both push — the index meant to stop them
 * could never fire — after which `receipts.find(...)` returned an arbitrary one
 * and the unread count derived from whichever it happened to be.
 */

describeIntegration('conversation model', () => {
  const alice = new Types.ObjectId();
  const bob = new Types.ObjectId();

  beforeEach(resetDatabase);
  afterEach(resetDatabase);

  const makeConversation = () =>
    Conversation.create({
      participants: [alice, bob],
      is_group: false,
      dm_key: buildDmKey([alice, bob]),
    });

  it('rejects a second DM between the same pair', async () => {
    await makeConversation();
    // A unique index on `participants` itself does not work — a unique multikey
    // index enforces uniqueness per array *element*, so the second DM
    // containing a given user would fail. Hence the scalar key.
    await expect(makeConversation()).rejects.toMatchObject({ code: 11000 });
  });

  it('still allows each user other DMs', async () => {
    await makeConversation();
    const carol = new Types.ObjectId();

    await expect(
      Conversation.create({
        participants: [alice, carol],
        is_group: false,
        dm_key: buildDmKey([alice, carol]),
      }),
    ).resolves.toBeDefined();
  });

  it('does not constrain groups, which carry no dm_key', async () => {
    // The partial filter expression is what keeps many `dm_key: undefined`
    // documents from colliding with each other.
    const group = () =>
      Conversation.create({
        participants: [alice, bob, new Types.ObjectId()],
        is_group: true,
      });

    await expect(group()).resolves.toBeDefined();
    await expect(group()).resolves.toBeDefined();
  });

  it('creates a receipt on first read', async () => {
    const conversation = await makeConversation();
    const messageId = new Types.ObjectId();
    const readAt = new Date();

    const updated = await upsertReadReceipt(
      conversation._id as Types.ObjectId,
      alice,
      messageId,
      readAt,
    );

    expect(updated).not.toBeNull();
    // The caller only reads `participants` off the result, and uses it to
    // decide who to tell.
    expect(updated!.participants.map(String)).toContain(alice.toString());

    const stored = await Conversation.findById(conversation._id).lean();
    expect(stored!.read_receipts).toHaveLength(1);
    expect(String(stored!.read_receipts[0].last_message_read_id)).toBe(
      messageId.toString(),
    );
  });

  it('advances an existing receipt rather than adding a second', async () => {
    const conversation = await makeConversation();
    const first = new Types.ObjectId();
    const second = new Types.ObjectId();

    await upsertReadReceipt(conversation._id as Types.ObjectId, alice, first, new Date());
    await upsertReadReceipt(conversation._id as Types.ObjectId, alice, second, new Date());

    const stored = await Conversation.findById(conversation._id).lean();
    expect(stored!.read_receipts).toHaveLength(1);
    expect(String(stored!.read_receipts[0].last_message_read_id)).toBe(
      second.toString(),
    );
  });

  it('keeps one receipt per user, not one per conversation', async () => {
    const conversation = await makeConversation();

    await upsertReadReceipt(
      conversation._id as Types.ObjectId,
      alice,
      new Types.ObjectId(),
      new Date(),
    );
    await upsertReadReceipt(
      conversation._id as Types.ObjectId,
      bob,
      new Types.ObjectId(),
      new Date(),
    );

    const stored = await Conversation.findById(conversation._id).lean();
    expect(stored!.read_receipts).toHaveLength(2);
  });

  it('never duplicates a receipt when first reads race', async () => {
    const conversation = await makeConversation();

    // Ten concurrent first-receipts from the same user. The `$ne` filter on the
    // push is what makes the losers no-ops instead of duplicate entries.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        upsertReadReceipt(
          conversation._id as Types.ObjectId,
          alice,
          new Types.ObjectId(),
          new Date(),
        ),
      ),
    );

    const stored = await Conversation.findById(conversation._id).lean();
    expect(stored!.read_receipts).toHaveLength(1);

    /*
     * And every caller gets the conversation back.
     *
     * A racer that matched neither branch used to return null, which the
     * websocket handler read as failure and answered by skipping the broadcast
     * — so the *other* participants never saw the read tick move, for a receipt
     * that had in fact been recorded.
     */
    for (const result of results) {
      expect(result).not.toBeNull();
      expect(result!.participants.map(String)).toContain(alice.toString());
    }
  });

  it('returns null for a conversation that does not exist', async () => {
    // Still distinguishable from the race above: nothing to report.
    const missing = await upsertReadReceipt(
      new Types.ObjectId(),
      alice,
      new Types.ObjectId(),
      new Date(),
    );
    expect(missing).toBeNull();
  });
});
