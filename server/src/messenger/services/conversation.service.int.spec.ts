import { Types } from 'mongoose';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { describeIntegration, resetDatabase } from '../../test/env';
import { Conversation, IConversation } from '../models/conversation.model';
import { Message } from '../models/message.model';
import { MessageTypeEnum } from '../interfaces/message.interface';
import { User } from '../../user/models/user.model';
import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';

/*
 * Membership changes, against a real database.
 *
 * The bug these exist for could not be caught any other way: the leave event's
 * recipient list was built by calling `.toString()` on `conversation.participants`
 * *after* `populate()` had replaced the ObjectIds with documents — and
 * `Document.prototype.toString()` is `util.inspect` output, so every id in it
 * was a string like "{ username: 'x', _id: new ObjectId('...') }". The code
 * reads correctly, it type-checks, and nothing throws. The only signal is that
 * the members who stayed are never told anyone left.
 *
 * A mock would have reproduced neither the populate nor the toString.
 */

interface BroadcastCall {
  message: any;
  recipientIds?: string[];
}

const HEX_24 = /^[0-9a-f]{24}$/;

describeIntegration('ConversationService — membership', () => {
  let broadcasts: BroadcastCall[];
  let service: ConversationService;

  let admin: { _id: Types.ObjectId; username: string };
  let member: { _id: Types.ObjectId; username: string };
  let bystander: { _id: Types.ObjectId; username: string };

  const makeUser = async (username: string) => {
    const user = await User.create({
      first_name: username,
      last_name: 'Test',
      username,
      email: `${username}@example.test`,
      password: 'Str0ng!Passw0rd',
    });
    return { _id: user._id as Types.ObjectId, username };
  };

  /** The saved group, reloaded as a live document the service can mutate. */
  const loadGroup = async (id: Types.ObjectId): Promise<IConversation> =>
    (await Conversation.findById(id)) as IConversation;

  const infoMessages = () =>
    Message.find({ type: MessageTypeEnum.INFO }).sort({ timestamp: 1 }).lean();

  beforeEach(async () => {
    await resetDatabase();

    broadcasts = [];
    const broadcast = async (message: any, recipientIds?: string[]) => {
      broadcasts.push({ message, recipientIds });
    };

    const messageService = new MessageService(broadcast);
    service = new ConversationService(broadcast, messageService);

    admin = await makeUser('admin');
    member = await makeUser('member');
    bystander = await makeUser('bystander');
  });

  afterEach(async () => {
    await resetDatabase();
  });

  const createGroup = async () => {
    const conversation = await Conversation.create({
      participants: [admin._id, member._id, bystander._id],
      is_group: true,
      group_name: 'Test group',
      created_by: admin._id,
    });
    broadcasts = [];
    return conversation._id as Types.ObjectId;
  };

  const leaveBroadcast = () =>
    broadcasts.find((b) => b.message?.type === 'conversation-leave');

  it('names its leave recipients with real user ids, not inspected documents', async () => {
    const id = await createGroup();

    await service.manageConversationMembers(await loadGroup(id), admin._id.toString(), {
      add: [],
      remove: [member._id.toString()],
    });

    const event = leaveBroadcast();
    expect(event).toBeDefined();

    // The regression itself: every recipient must be a bare ObjectId hex.
    for (const recipient of event!.recipientIds ?? []) {
      expect(recipient).toMatch(HEX_24);
    }
  });

  it('tells the members who stayed, as well as the one removed', async () => {
    const id = await createGroup();

    await service.manageConversationMembers(await loadGroup(id), admin._id.toString(), {
      add: [],
      remove: [member._id.toString()],
    });

    const recipients = new Set(leaveBroadcast()!.recipientIds ?? []);

    // The removed user always worked — their id came from `remove`, untouched.
    expect(recipients).toContain(member._id.toString());
    // These two are what silently went missing: their rosters stayed stale.
    expect(recipients).toContain(admin._id.toString());
    expect(recipients).toContain(bystander._id.toString());
  });

  it('records who left by name when a member removes themselves', async () => {
    const id = await createGroup();

    // Leaving filters the actor out of `participants` before the populate, so
    // looking them up there finds nothing — which is how this became
    // "A member left the conversation".
    await service.manageConversationMembers(await loadGroup(id), member._id.toString(), {
      add: [],
      remove: [member._id.toString()],
    });

    const [info] = await infoMessages();
    expect(info.content).toContain('member');
    expect(info.content).not.toContain('A member left');

    expect(leaveBroadcast()!.message.removed_by).toMatchObject({
      username: 'member',
    });
  });

  it('names the admin when they remove someone else', async () => {
    const id = await createGroup();

    await service.manageConversationMembers(await loadGroup(id), admin._id.toString(), {
      add: [],
      remove: [member._id.toString()],
    });

    const [info] = await infoMessages();
    expect(info.content).toContain('member'); // who was removed
    expect(info.content).toContain('admin'); // who did it
    expect(info.content).not.toContain('an admin'); // i.e. not the fallback
  });

  it('actually removes the member from the stored conversation', async () => {
    const id = await createGroup();

    await service.manageConversationMembers(await loadGroup(id), admin._id.toString(), {
      add: [],
      remove: [member._id.toString()],
    });

    const stored = await Conversation.findById(id).lean();
    const ids = stored!.participants.map(String);
    expect(ids).not.toContain(member._id.toString());
    expect(ids).toHaveLength(2);
  });

  it('lets any member leave without being an admin', async () => {
    const id = await createGroup();

    await expect(
      service.manageConversationMembers(await loadGroup(id), bystander._id.toString(), {
        add: [],
        remove: [bystander._id.toString()],
      }),
    ).resolves.toBeDefined();
  });

  it('refuses to let a non-admin remove somebody else', async () => {
    // Without this any participant could kick every other participant,
    // the creator included.
    const id = await createGroup();

    await expect(
      service.manageConversationMembers(await loadGroup(id), member._id.toString(), {
        add: [],
        remove: [bystander._id.toString()],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses to let a non-admin add anybody', async () => {
    const id = await createGroup();
    const outsider = await makeUser('outsider');

    await expect(
      service.manageConversationMembers(await loadGroup(id), member._id.toString(), {
        add: [outsider._id.toString()],
        remove: [],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses members that do not exist', async () => {
    // A well-formed but unused ObjectId used to be pushed straight into the
    // participant list, leaving a member nothing could resolve.
    const id = await createGroup();

    await expect(
      service.manageConversationMembers(await loadGroup(id), admin._id.toString(), {
        add: [new Types.ObjectId().toString()],
        remove: [],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses membership changes on a direct message', async () => {
    const dm = await Conversation.create({
      participants: [admin._id, member._id],
      is_group: false,
      dm_key: [admin._id, member._id].map(String).sort().join(':'),
    });

    await expect(
      service.manageConversationMembers(
        (await loadGroup(dm._id as Types.ObjectId))!,
        admin._id.toString(),
        { add: [], remove: [member._id.toString()] },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('lets the admin add a member, and announces it', async () => {
    const id = await createGroup();
    const outsider = await makeUser('outsider');

    await service.manageConversationMembers(await loadGroup(id), admin._id.toString(), {
      add: [outsider._id.toString()],
      remove: [],
    });

    const stored = await Conversation.findById(id).lean();
    expect(stored!.participants.map(String)).toContain(
      outsider._id.toString(),
    );

    const join = broadcasts.find((b) => b.message?.type === 'conversation-join');
    expect(join).toBeDefined();
  });

  it('only lets the creator delete a group', async () => {
    // Deleting destroys every message for every member; any member being able
    // to do it means any member can wipe the whole thread.
    const id = await createGroup();

    await expect(
      service.deleteConversation(await loadGroup(id), member._id.toString()),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      service.deleteConversation(await loadGroup(id), admin._id.toString()),
    ).resolves.toBeUndefined();

    expect(await Conversation.findById(id)).toBeNull();
  });
});
