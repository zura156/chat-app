import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeIntegration, resetDatabase } from '../../test/env';
import { User } from '../../user/models/user.model';
import { Conversation } from '../../messenger/models/conversation.model';
import { Upload } from '../../upload/upload.model';
import { JobPayload, ProcessResult } from './types';

/*
 * What happens to the database once an image finishes processing.
 *
 * Two things were wrong here, and they are the same mistake seen from either
 * end. `imageHandler` uploads three sizes for every image context — 64px, 400px
 * and 1200px — and the completion handlers stored one URL and forgot the rest:
 *
 *   - `pfp_variants` and `cover_variants` were declared on the schema, selected
 *     by every `populate` in the app and exposed on the public user fields, but
 *     nothing wrote them. The chatbox renders each message's avatar from
 *     `sender.pfp_variants.thumb`, so it always found `undefined` and fell
 *     through to the generic placeholder icon. Profile pictures never appeared
 *     in a conversation at all.
 *
 *   - Nothing removed the upload a new one replaced. Three objects per change,
 *     kept forever, and the storage screen sums `Upload` rows by context — so
 *     the "Profile media" figure counted every avatar the user had ever had.
 *
 * The S3 client is configured from empty env vars in a test run, so object
 * deletion is stubbed; what these assert is the bookkeeping, which is the half
 * that was wrong.
 */

const sent = vi.fn(async () => ({}));
vi.mock('../../config/s3', () => ({
  s3App: { send: (...args: unknown[]) => sent(...(args as [])) },
}));

// Both of these publish to Redis, which this story does not involve.
vi.mock('../../utils/ws-emit', () => ({
  emitToUser: vi.fn(async () => undefined),
  broadcastToParticipants: vi.fn(async () => undefined),
}));

vi.mock('../../upload/media-url.service', () => ({
  signVariants: vi.fn(async (v: unknown) => v),
}));

// Static, not `await import`: vitest hoists `vi.mock` above the imports, so the
// mocks above are already in place, and a top-level await here is not valid
// under the spec tsconfig.
import {
  onAvatarComplete,
  onCoverPhotoComplete,
  onGroupAvatarComplete,
} from './side-effects';

const VARIANTS = {
  thumb: 'https://cdn.test/media-public/avatar/u/1/thumb.webp',
  medium: 'https://cdn.test/media-public/avatar/u/1/medium.webp',
  large: 'https://cdn.test/media-public/avatar/u/1/large.webp',
};

const resultOf = (variants = VARIANTS): ProcessResult =>
  ({ variants, finalBucket: 'media-public', finalKey: 'k' }) as ProcessResult;

describeIntegration('image completion handlers', () => {
  const makeUser = async (username: string) =>
    User.create({
      first_name: username,
      last_name: 'Test',
      username,
      email: `${username}@example.test`,
      password: 'Str0ng!Passw0rd',
    });

  const makeUpload = (
    id: string,
    context: string,
    userId: Types.ObjectId,
    resourceId: string | null = null,
  ) =>
    Upload.create({
      _id: id,
      userId,
      context,
      resourceId,
      fileKey: `${context}/${userId}/${id}/original.jpg`,
      mimeType: 'image/jpeg',
      fileSize: 1024,
      status: 'ready',
      variants: VARIANTS,
    });

  const payloadFor = (
    uploadId: string,
    context: string,
    userId: string,
    resourceId: string | null = null,
  ): JobPayload =>
    ({
      uploadId,
      userId,
      context,
      resourceId,
      fileKey: `${context}/${userId}/${uploadId}/original.jpg`,
      mimeType: 'image/jpeg',
    }) as JobPayload;

  beforeEach(async () => {
    await resetDatabase();
    sent.mockClear();
  });
  afterEach(resetDatabase);

  describe('onAvatarComplete', () => {
    it('stores every size, not just the one it displays', async () => {
      const user = await makeUser('ada');
      await onAvatarComplete(
        payloadFor('up-new', 'avatar', user._id.toString()),
        resultOf(),
      );

      const after = await User.findById(user._id);
      expect(after!.pfp_url).toBe(VARIANTS.medium);
      expect(after!.pfp_variants?.thumb).toBe(VARIANTS.thumb);
      expect(after!.pfp_variants?.medium).toBe(VARIANTS.medium);
      expect(after!.pfp_variants?.large).toBe(VARIANTS.large);
    });

    it('gives the chatbox a thumb to render', async () => {
      // The actual failure: `sender.pfp_variants?.thumb ?? '/icons/avatar.svg'`
      // in the message list. Undefined here is a placeholder on every message.
      const user = await makeUser('ada');
      await onAvatarComplete(
        payloadFor('up-new', 'avatar', user._id.toString()),
        resultOf(),
      );

      const populated = await User.findById(user._id)
        .select('username pfp_url pfp_variants')
        .lean();

      expect(populated!.pfp_variants?.thumb).toBeTruthy();
    });

    it('drops the avatar it replaces', async () => {
      const user = await makeUser('ada');
      await makeUpload('up-old', 'avatar', user._id);
      await makeUpload('up-new', 'avatar', user._id);

      await onAvatarComplete(
        payloadFor('up-new', 'avatar', user._id.toString()),
        resultOf(),
      );

      expect(await Upload.findById('up-old')).toBeNull();
      expect(await Upload.findById('up-new')).not.toBeNull();
    });

    it('leaves another user’s avatar alone', async () => {
      const [ada, grace] = await Promise.all([
        makeUser('ada'),
        makeUser('grace'),
      ]);
      await makeUpload('grace-avatar', 'avatar', grace._id);
      await makeUpload('ada-new', 'avatar', ada._id);

      await onAvatarComplete(
        payloadFor('ada-new', 'avatar', ada._id.toString()),
        resultOf(),
      );

      expect(await Upload.findById('grace-avatar')).not.toBeNull();
    });

    it('leaves the same user’s other uploads alone', async () => {
      // Scoped by context as well as owner: a new avatar must not take the
      // attachments they have sent in conversations with it.
      const user = await makeUser('ada');
      await makeUpload('an-attachment', 'dm-image', user._id);
      await makeUpload('a-cover', 'cover-photo', user._id);
      await makeUpload('up-new', 'avatar', user._id);

      await onAvatarComplete(
        payloadFor('up-new', 'avatar', user._id.toString()),
        resultOf(),
      );

      expect(await Upload.findById('an-attachment')).not.toBeNull();
      expect(await Upload.findById('a-cover')).not.toBeNull();
    });
  });

  describe('onCoverPhotoComplete', () => {
    it('stores every size', async () => {
      const user = await makeUser('ada');
      await onCoverPhotoComplete(
        payloadFor('cover-new', 'cover-photo', user._id.toString()),
        resultOf(),
      );

      const after = await User.findById(user._id);
      expect(after!.cover_url).toBe(VARIANTS.large);
      // The schema used to declare `sm`/`md` — names the handler never produces,
      // so the field could not have been populated even if something had tried.
      expect(after!.cover_variants?.thumb).toBe(VARIANTS.thumb);
      expect(after!.cover_variants?.medium).toBe(VARIANTS.medium);
      expect(after!.cover_variants?.large).toBe(VARIANTS.large);
    });

    it('drops the cover photo it replaces', async () => {
      const user = await makeUser('ada');
      await makeUpload('cover-old', 'cover-photo', user._id);
      await makeUpload('cover-new', 'cover-photo', user._id);

      await onCoverPhotoComplete(
        payloadFor('cover-new', 'cover-photo', user._id.toString()),
        resultOf(),
      );

      expect(await Upload.findById('cover-old')).toBeNull();
      expect(await Upload.findById('cover-new')).not.toBeNull();
    });
  });

  describe('onGroupAvatarComplete', () => {
    const makeGroup = async (creator: Types.ObjectId) =>
      Conversation.create({
        participants: [creator],
        is_group: true,
        group_name: 'Test group',
        created_by: creator,
      });

    it('drops the previous picture for that conversation', async () => {
      const user = await makeUser('ada');
      const group = await makeGroup(user._id);
      const groupId = group._id.toString();

      await makeUpload('group-old', 'group-avatar', user._id, groupId);
      await makeUpload('group-new', 'group-avatar', user._id, groupId);

      await onGroupAvatarComplete(
        payloadFor('group-new', 'group-avatar', user._id.toString(), groupId),
        resultOf(),
      );

      expect(await Upload.findById('group-old')).toBeNull();
      expect(await Upload.findById('group-new')).not.toBeNull();
    });

    it('scopes the purge to the conversation, not the uploader', async () => {
      /*
       * The case that makes `userId` the wrong key: two groups, one person who
       * set the picture in both. Scoping by uploader would have the second
       * change delete the first group's current picture.
       */
      const user = await makeUser('ada');
      const [first, second] = await Promise.all([
        makeGroup(user._id),
        makeGroup(user._id),
      ]);

      await makeUpload(
        'first-group-pic',
        'group-avatar',
        user._id,
        first._id.toString(),
      );
      await makeUpload(
        'second-group-pic',
        'group-avatar',
        user._id,
        second._id.toString(),
      );

      await onGroupAvatarComplete(
        payloadFor(
          'second-group-pic',
          'group-avatar',
          user._id.toString(),
          second._id.toString(),
        ),
        resultOf(),
      );

      expect(await Upload.findById('first-group-pic')).not.toBeNull();
    });

    it('stores the whole variant set on the conversation', async () => {
      const user = await makeUser('ada');
      const group = await makeGroup(user._id);

      await onGroupAvatarComplete(
        payloadFor(
          'group-new',
          'group-avatar',
          user._id.toString(),
          group._id.toString(),
        ),
        resultOf(),
      );

      const after = await Conversation.findById(group._id);
      expect(after!.group_picture).toBe(VARIANTS.medium);
      expect(after!.group_picture_variants?.thumb).toBe(VARIANTS.thumb);
      expect(after!.group_picture_variants?.large).toBe(VARIANTS.large);
    });
  });
});
