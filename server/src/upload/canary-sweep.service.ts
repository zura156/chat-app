import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { Types } from 'mongoose';
import { s3Quarantine } from '../config/s3';
import config from '../config/config';
import { logger } from '../utils/logger';
import { quarantineKeyFor } from '../utils/quarantine';
import { Upload, type UploadStatus } from './upload.model';
import { purgeUploads } from './upload-cleanup.service';

/*
 * Sentinel's upload canary (Z, ADR 0031) uploads a clean file and the EICAR
 * test string as its own account every ten minutes. Nothing else would ever
 * remove them: a ready `dm-file` is exempt from the TTL reaper (it is assumed
 * to be in a message), and an infected one leaves a copy in the quarantine
 * bucket that nothing deletes. The worker runs this sweep every hour.
 */

/** How often the worker sweeps. */
export const CANARY_SWEEP_EVERY_MS = 60 * 60 * 1000;

/** Older than any canary run, which gives up five minutes after confirming. */
const MIN_AGE_MS = 60 * 60 * 1000;

/*
 * Finished uploads only. One still `pending` or `processing` after an hour
 * means the worker was down; swept then, an EICAR in that backlog would still
 * reach quarantine afterwards with no record left to find its copy by. Those
 * records keep the 24 h TTL presign gave them, so the reaper takes any that
 * never finish.
 */
const FINISHED: UploadStatus[] = ['ready', 'failed', 'infected'];

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** S3 accepts at most 1000 keys per DeleteObjects call. */
const DELETE_BATCH = 1000;

type Swept = { _id: string; status: UploadStatus; fileKey: string };

/**
 * Deletes infected uploads' quarantine copies with the `quarantine-writer`
 * credentials that wrote them, and returns the ids whose copies are gone.
 *
 * Unlike purgeUploads, a refusal is not shrugged off: the caller keeps those
 * records, because a record is the only way to find its copy again.
 */
const deleteQuarantined = async (uploads: Swept[]): Promise<Set<string>> => {
  const gone = new Set<string>();

  for (let i = 0; i < uploads.length; i += DELETE_BATCH) {
    const batch = uploads
      .slice(i, i + DELETE_BATCH)
      .map((u) => ({ id: u._id, key: quarantineKeyFor(u.fileKey, u._id) }));

    try {
      const result = await s3Quarantine.send(
        new DeleteObjectsCommand({
          Bucket: config.s3QuarantineBucket,
          Delete: { Objects: batch.map(({ key }) => ({ Key: key })), Quiet: true },
        }),
      );
      // DeleteObjects answers 200 and lists per-key refusals under Errors.
      const refused = new Set((result.Errors ?? []).map((e) => e.Key));
      for (const { id, key } of batch) if (!refused.has(key)) gone.add(id);
      if (refused.size > 0) {
        logger.error('Canary sweep: quarantine refused some deletes', {
          refused: refused.size,
          codes: [...new Set((result.Errors ?? []).map((e) => e.Code))],
        });
      }
    } catch (error) {
      logger.error(
        `Canary sweep: failed to delete ${batch.length} quarantine objects`,
        error,
      );
    }
  }

  return gone;
};

/**
 * Removes the canary account's finished uploads that are over an hour old:
 * quarantine copies first, then the stored objects and records through
 * purgeUploads. Returns how many records went. Safe to run from several
 * worker replicas at once: every step is idempotent.
 */
export const sweepCanaryUploads = async (
  userId: string,
  now: Date = new Date(),
): Promise<number> => {
  // Checked here as well as in config: this id becomes a delete's filter.
  if (!OBJECT_ID.test(userId)) return 0;
  const owner = new Types.ObjectId(userId);

  const uploads = await Upload.find({
    userId: owner,
    status: { $in: FINISHED },
    createdAt: { $lt: new Date(now.getTime() - MIN_AGE_MS) },
  })
    .select('_id status fileKey')
    .lean<Swept[]>();

  if (uploads.length === 0) return 0;

  const infected = uploads.filter((u) => u.status === 'infected');
  const cleared =
    infected.length > 0 ? await deleteQuarantined(infected) : new Set<string>();

  const ids = uploads
    .filter((u) => u.status !== 'infected' || cleared.has(u._id))
    .map((u) => u._id);

  if (ids.length === 0) return 0;

  // By the ids read above, not the age filter again: that would also take an
  // infected record whose copy was just refused.
  return purgeUploads({ _id: { $in: ids }, userId: owner });
};
