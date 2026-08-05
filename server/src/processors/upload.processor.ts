import { Job } from 'bullmq';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { contextHandlers } from './handlers';
import { Upload } from '../upload/upload.model';
import { s3App } from '../config/s3';
import { scanStream } from '../utils/clamav';
import { moveToQuarantine } from '../utils/quarantine';
import { JobPayload } from './handlers/types';
import {
  markAttachmentStatus,
  notifyAttachmentOutcome,
} from '../utils/attachment-status';
import { signVariants } from '../upload/media-url.service';
import config from '../config/config';
import { Readable } from 'stream';
import { emitToUser } from '../utils/ws-emit';
import { logger } from '../utils/logger';

const SCAN_CONTEXTS = ['dm-file'];

/**
 * Removes the original from the temp bucket. Best-effort and idempotent: it
 * runs on the success path and, via the worker's `failed` handler, once retries
 * are exhausted. Previously it ran only on success, so every upload that failed
 * permanently left its bytes in the bucket with no record pointing at them.
 */
export const discardTempObject = async (fileKey: string): Promise<void> => {
  try {
    await s3App.send(
      new DeleteObjectCommand({
        Bucket: config.s3TempBucket,
        Key: fileKey,
      }),
    );
  } catch (error) {
    logger.error(`Failed to delete temp object ${fileKey}`, error);
  }
};

export const processUpload = async (job: Job<JobPayload>) => {
  const payload = job.data;

  // only scan raw files — media gets re-encoded which destroys any payload
  if (SCAN_CONTEXTS.includes(payload.context)) {
    const s3Object = await s3App.send(
      new GetObjectCommand({
        Bucket: config.s3TempBucket,
        Key: payload.fileKey,
      }),
    );

    const { isInfected, viruses } = await scanStream(s3Object.Body as Readable);

    if (isInfected) {
      await moveToQuarantine(payload.fileKey, payload.uploadId, viruses);
      await Upload.findByIdAndUpdate(payload.uploadId, { status: 'infected' });
      await markAttachmentStatus(payload.uploadId, 'infected');

      const infectedEvent = {
        type: 'upload-infected',
        uploadId: payload.uploadId,
        context: payload.context,
      };
      // the uploader gets the virus names; the rest of the conversation only
      // needs to know the attachment is not coming
      await emitToUser(payload.userId, { ...infectedEvent, viruses });
      await notifyAttachmentOutcome(
        payload.uploadId,
        infectedEvent,
        payload.userId,
      );

      // The object has been copied to quarantine; the temp copy is no longer
      // needed and would otherwise sit in the bucket forever.
      await discardTempObject(payload.fileKey);
      return;
    }
  }

  const handlerConfig = contextHandlers[payload.context];
  if (!handlerConfig)
    throw new Error(`No handler for context: ${payload.context}`);

  const result = await handlerConfig.handler(payload);

  await Upload.findByIdAndUpdate(payload.uploadId, {
    status: 'ready',
    variants: result.variants,
    duration: result.duration,
    // the record is now referenced by a message — exempt it from the TTL reaper
    expiresAt: null,
  });

  await handlerConfig.onComplete(payload, result);

  await emitToUser(payload.userId, {
    type: 'upload-ready',
    uploadId: payload.uploadId,
    context: payload.context,
    // What the upload was *for*. Without it a client receiving this event knows
    // an image finished but not which conversation's avatar it became, so the
    // uploader's own view had to wait on the separate conversation-update event
    // to catch up — and if that one was missed, the picture only appeared after
    // a reload.
    resourceId: payload.resourceId ?? null,
    duration: result.duration,
    variants: await signVariants(result.variants),
  });

  await discardTempObject(payload.fileKey);
};
