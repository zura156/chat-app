import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { Types } from 'mongoose';
import { s3App } from '../config/s3';
import config from '../config/config';
import { logger } from '../utils/logger';
import { Upload } from './upload.model';
import { Message } from '../messenger/models/message.model';

/*
 * Nothing used to remove stored objects. Deleting a conversation dropped its
 * messages but left every attachment in the bucket; deleting an account left
 * everything. Both grow forever and both are the user's data sitting somewhere
 * they were told it no longer was.
 */

/** S3 accepts at most 1000 keys per DeleteObjects call. */
const DELETE_BATCH = 1000;

const bucketForContext = (context: string): string =>
  context.startsWith('dm-') ? config.s3PrivateBucket : config.s3PublicBucket;

/**
 * Every stored object an upload produced: the processed variants, plus the
 * original in the temp bucket if the job never got far enough to clear it.
 */
const keysForUpload = (upload: {
  context: string;
  fileKey?: string | null;
  variants?: unknown;
}): { bucket: string; key: string }[] => {
  const keys: { bucket: string; key: string }[] = [];
  const bucket = bucketForContext(upload.context);

  if (upload.variants && typeof upload.variants === 'object') {
    for (const value of Object.values(upload.variants as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      // Variants are stored as absolute URLs; the key is what follows the
      // bucket. Anything that does not look like ours is left alone.
      const prefix = `${config.s3Url}/${bucket}/`;
      if (value.startsWith(prefix)) {
        keys.push({ bucket, key: value.slice(prefix.length) });
      }
    }
  }

  if (upload.fileKey) {
    keys.push({ bucket: config.s3TempBucket, key: upload.fileKey });
  }

  return keys;
};

/** Best-effort: a storage failure must not abort the database cleanup. */
const deleteObjects = async (
  bucket: string,
  keys: string[],
): Promise<void> => {
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const batch = keys.slice(i, i + DELETE_BATCH);
    try {
      await s3App.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    } catch (error) {
      logger.error(
        `Failed to delete ${batch.length} objects from ${bucket}`,
        error,
      );
    }
  }
};

/** Removes the given uploads' objects and then their records. */
export const purgeUploads = async (
  filter: Record<string, unknown>,
): Promise<number> => {
  const uploads = await Upload.find(filter)
    .select('context fileKey variants')
    .lean();

  if (uploads.length === 0) return 0;

  const byBucket = new Map<string, string[]>();
  for (const upload of uploads) {
    for (const { bucket, key } of keysForUpload(upload as never)) {
      if (!bucket) continue;
      const existing = byBucket.get(bucket);
      if (existing) existing.push(key);
      else byBucket.set(bucket, [key]);
    }
  }

  await Promise.all(
    [...byBucket.entries()].map(([bucket, keys]) => deleteObjects(bucket, keys)),
  );

  await Upload.deleteMany(filter);

  return uploads.length;
};

/** Every attachment sent in a conversation, by upload id. */
export const purgeConversationUploads = async (
  conversationId: Types.ObjectId,
): Promise<void> => {
  const uploadIds = await Message.distinct('attachments.uploadId', {
    conversation: conversationId,
  });

  if (uploadIds.length === 0) return;

  await purgeUploads({ _id: { $in: uploadIds } });
};
