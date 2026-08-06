import { Types } from 'mongoose';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeIntegration, resetDatabase } from '../../test/env';
import { User } from '../models/user.model';
import { Conversation } from '../../messenger/models/conversation.model';
import { Message } from '../../messenger/models/message.model';
import { Notification } from '../../messenger/models/notifications.model';
import { MutedConversation } from '../../messenger/models/muted-conversation.model';
import { deleteAccount } from './account-deletion.service';

/*
 * Closing an account used to remove exactly one document: the user. Everything
 * else stayed — messages, uploads, notifications, mutes, and every other user's
 * block list still naming them.
 *
 * These pin the cascade down, including the case that is easy to miss: a group
 * whose creator leaves. `created_by` is the only thing that grants admin, and
 * there is no ownership transfer in the UI, so a dangling one makes the group
 * permanently unmanageable — by everyone, forever.
 */

// The S3 client is configured from empty env vars in a test run, and purging
// stored objects is not what any of this is about.
vi.mock('../../upload/upload-cleanup.service', () => ({
  purgeUploads: vi.fn(async () => undefined),
  purgeConversationUploads: vi.fn(async () => undefined),
}));

// Refresh tokens live in Redis; the account cascade is a MongoDB story.
vi.mock('../../auth/services/token.service', () => ({
  deleteAllUserRefreshTokens: vi.fn(async () => undefined),
}));

describeIntegration('deleteAccount', () => {
  const makeUser = async (username: string) =>
    User.create({
      first_name: username,
      last_name: 'Test',
      username,
      email: `${username}@example.test`,
      password: 'Str0ng!Passw0rd',
    });

  beforeEach(resetDatabase);
  afterEach(resetDatabase);

  it('hands a group on to a remaining member when its creator leaves', async () => {
    const owner = await makeUser('owner');
    const second = await makeUser('second');
    const third = await makeUser('third');

    const group = await Conversation.create({
      participants: [owner._id, second._id, third._id],
      is_group: true,
      group_name: 'Orphan test',
      created_by: owner._id,
    });

    await deleteAccount(owner._id as Types.ObjectId);

    const stored = await Conversation.findById(group._id).lean();
    expect(stored).not.toBeNull();

    // The point: somebody is still the admin. Which of the two is arbitrary.
    const heir = String(stored!.created_by);
    expect(heir).not.toBe(String(owner._id));
    expect([String(second._id), String(third._id)]).toContain(heir);

    // And the heir is genuinely still in the group they now administer.
    expect(stored!.participants.map(String)).toContain(heir);
  });

  it('leaves an unrelated creator alone', async () => {
    const owner = await makeUser('owner');
    const leaver = await makeUser('leaver');
    const other = await makeUser('other');

    const group = await Conversation.create({
      participants: [owner._id, leaver._id, other._id],
      is_group: true,
      created_by: owner._id,
    });

    await deleteAccount(leaver._id as Types.ObjectId);

    const stored = await Conversation.findById(group._id).lean();
    expect(String(stored!.created_by)).toBe(String(owner._id));
  });

  it('removes the departing user from the groups that survive', async () => {
    const owner = await makeUser('owner');
    const second = await makeUser('second');
    const third = await makeUser('third');

    const group = await Conversation.create({
      participants: [owner._id, second._id, third._id],
      is_group: true,
      created_by: owner._id,
    });

    await deleteAccount(third._id as Types.ObjectId);

    const stored = await Conversation.findById(group._id).lean();
    expect(stored!.participants.map(String)).not.toContain(String(third._id));
    expect(stored!.participants).toHaveLength(2);
  });

  it('deletes a DM outright — one party is not a conversation', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');

    const dm = await Conversation.create({
      participants: [alice._id, bob._id],
      is_group: false,
      dm_key: [alice._id, bob._id].map(String).sort().join(':'),
    });
    await Message.create({
      sender: bob._id,
      conversation: dm._id,
      content: 'hi',
    });

    await deleteAccount(alice._id as Types.ObjectId);

    // Otherwise it sits in bob's list forever, unopenable.
    expect(await Conversation.findById(dm._id)).toBeNull();
    expect(await Message.countDocuments({ conversation: dm._id })).toBe(0);
  });

  it('tombstones the departing user’s messages instead of deleting them', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const carol = await makeUser('carol');

    const group = await Conversation.create({
      participants: [alice._id, bob._id, carol._id],
      is_group: true,
      created_by: bob._id,
    });
    const message = await Message.create({
      sender: alice._id,
      conversation: group._id,
      content: 'secret',
    });

    await deleteAccount(alice._id as Types.ObjectId);

    /*
     * The rows are load-bearing: read receipts point at message ids and
     * `last_message` references them, so removing them would leave the other
     * participants' unread counts with no watermark. The content — the part
     * that is actually the user's data — is what goes.
     */
    const stored = await Message.findById(message._id).lean();
    expect(stored).not.toBeNull();
    expect(stored!.content).toBeUndefined();
    expect(stored!.deleted_at).toBeInstanceOf(Date);
  });

  it('clears the departing user from everyone else’s block list', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');

    await User.updateOne(
      { _id: bob._id },
      { $addToSet: { blocked_users: alice._id } },
    );

    await deleteAccount(alice._id as Types.ObjectId);

    // A block naming an account that no longer exists renders as a blank row
    // on the privacy screen and silently filters nobody.
    const stored = await User.findById(bob._id).lean();
    expect(stored!.blocked_users.map(String)).not.toContain(String(alice._id));
  });

  it('removes the user’s notifications, mutes and record', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');

    const group = await Conversation.create({
      participants: [alice._id, bob._id, (await makeUser('carol'))._id],
      is_group: true,
      created_by: bob._id,
    });
    await Notification.create({
      user: alice._id,
      conversation: group._id,
      unread_count: 3,
      seen: false,
    });
    await MutedConversation.create({ user: alice._id, conversation: group._id });

    await deleteAccount(alice._id as Types.ObjectId);

    expect(await Notification.countDocuments({ user: alice._id })).toBe(0);
    expect(await MutedConversation.countDocuments({ user: alice._id })).toBe(0);
    expect(await User.findById(alice._id)).toBeNull();
  });
});
