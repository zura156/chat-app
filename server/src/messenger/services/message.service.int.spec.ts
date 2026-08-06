import { Types } from 'mongoose';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { describeIntegration, resetDatabase } from '../../test/env';
import { Conversation } from '../models/conversation.model';
import { Message } from '../models/message.model';
import { MessageTypeEnum } from '../interfaces/message.interface';
import { User } from '../../user/models/user.model';
import { MessageService } from './message.service';

/*
 * What a deleted message is allowed to still say about itself.
 *
 * Deleting is a soft delete — the row has to survive, because read receipts
 * name message ids and the conversation's `last_message` points at one. That
 * makes "what is left behind" a real decision rather than a consequence, and it
 * was under-cleared: `type` and `edited_at` outlived the content they
 * described, so a deleted photo was still identifiable as a photo (the
 * conversation list captioned it "📷 Photo") and a deleted video or file was
 * still drawn differently from a deleted text in the thread.
 *
 * These run against a real database because the interesting part is the stored
 * document, after mongoose has applied its defaults and unset what was set to
 * undefined — precisely what a mocked `save()` would not do. The `type` default
 * in particular means "cleared" and "absent" are the same write with different
 * outcomes.
 */
describeIntegration('MessageService — delete', () => {
  let service: MessageService;
  let broadcasts: any[];

  let sender: Types.ObjectId;
  let other: Types.ObjectId;
  let conversation: Types.ObjectId;

  const makeUser = async (username: string) => {
    const user = await User.create({
      first_name: username,
      last_name: 'Test',
      username,
      email: `${username}@example.test`,
      password: 'Str0ng!Passw0rd',
    });
    return user._id as Types.ObjectId;
  };

  beforeEach(async () => {
    await resetDatabase();

    broadcasts = [];
    service = new MessageService((message: any) => {
      broadcasts.push(message);
    });

    sender = await makeUser('sender');
    other = await makeUser('other');

    const convo = await Conversation.create({
      participants: [sender, other],
      is_group: false,
      read_receipts: [],
    });
    conversation = convo._id as Types.ObjectId;
  });

  afterEach(async () => {
    await resetDatabase();
  });

  /** An image message that has also been edited — the most to strip. */
  const makeImageMessage = async () =>
    Message.create({
      sender,
      conversation,
      content: 'look at this',
      type: MessageTypeEnum.IMAGE,
      edited_at: new Date(),
      attachments: [
        {
          uploadId: 'upload-1',
          context: 'dm-image',
          mimeType: 'image/jpeg',
          fileSize: 1234,
          status: 'ready',
          variants: { medium: '/media/medium.jpg' },
          originalName: 'secret-holiday.jpg',
        },
      ],
    });

  it('leaves nothing behind that describes what the message was', async () => {
    const message = await makeImageMessage();

    await service.deleteMessage(
      sender.toString(),
      conversation.toString(),
      String(message._id),
    );

    // `.lean()` so this is the stored document, not a hydrated one that would
    // re-apply schema defaults over the top of the delete.
    const stored: any = await Message.findById(message._id).lean();

    expect(stored.content).toBeUndefined();
    expect(stored.attachments).toEqual([]);
    expect(stored.edited_at).toBeUndefined();
    // Normalised, not unset: every `switch (type)` on both sides of the wire is
    // written over the enum, and a tombstone is a line of text.
    expect(stored.type).toBe(MessageTypeEnum.TEXT);
    expect(stored.deleted_at).toBeInstanceOf(Date);
  });

  it('keeps what the thread is built on', async () => {
    const message = await makeImageMessage();
    const timestamp = message.timestamp;

    await service.deleteMessage(
      sender.toString(),
      conversation.toString(),
      String(message._id),
    );

    const stored: any = await Message.findById(message._id).lean();

    // Read receipts name the id, unread counts derive from the timestamp, and
    // the tombstone is attributed to its sender. Removing any of these is what
    // the soft delete exists to avoid.
    expect(String(stored._id)).toBe(String(message._id));
    expect(String(stored.sender)).toBe(sender.toString());
    expect(String(stored.conversation)).toBe(conversation.toString());
    expect(stored.timestamp.getTime()).toBe(timestamp.getTime());
  });

  it('survives the model validator that requires content or attachments', async () => {
    // The message is saved empty, which every other write path is forbidden to
    // do; the `pre('validate')` exemption for deleted rows is load-bearing and
    // silently regressing it would fail the delete, not the send.
    const message = await Message.create({
      sender,
      conversation,
      content: 'plain text',
      type: MessageTypeEnum.TEXT,
    });

    await expect(
      service.deleteMessage(
        sender.toString(),
        conversation.toString(),
        String(message._id),
      ),
    ).resolves.toMatchObject({ _id: String(message._id) });
  });

  it('tells the other participants, and refuses a second delete', async () => {
    const message = await makeImageMessage();

    await service.deleteMessage(
      sender.toString(),
      conversation.toString(),
      String(message._id),
    );

    const event = broadcasts.find((b) => b.type === 'message-deleted');
    expect(event).toBeDefined();
    expect(event.message._id).toBe(String(message._id));
    expect(event.message.deleted_at).toBeInstanceOf(Date);
    // The payload is the id and the marker — it must not re-broadcast the
    // content the delete just removed.
    expect(event.message).not.toHaveProperty('content');
    expect(event.message).not.toHaveProperty('attachments');

    await expect(
      service.deleteMessage(
        sender.toString(),
        conversation.toString(),
        String(message._id),
      ),
    ).rejects.toMatchObject({ statusCode: 410 });
  });

  it('will not let someone delete a message that is not theirs', async () => {
    const message = await makeImageMessage();

    await expect(
      service.deleteMessage(
        other.toString(),
        conversation.toString(),
        String(message._id),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    const stored: any = await Message.findById(message._id).lean();
    expect(stored.deleted_at).toBeUndefined();
    expect(stored.content).toBe('look at this');
  });
});
