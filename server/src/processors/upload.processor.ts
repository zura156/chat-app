import { Job } from 'bullmq';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { contextHandlers } from './handlers';
import { Upload } from '../upload/upload.model';
import { s3App } from '../config/s3';
import { scanStream } from '../utils/clamav';
import { moveToQuarantine } from '../utils/quarantine';
import { JobPayload } from './handlers/types';
import { markAttachmentStatus } from '../utils/attachment-status';
import config from '../config/config';
import { Readable } from 'stream';
import { emitToUser } from '../utils/ws-emit';

const SCAN_CONTEXTS = ['dm-file'];

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
      await emitToUser(payload.userId, {
        type: 'upload-infected',
        uploadId: payload.uploadId,
        context: payload.context,
        viruses,
      });
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
    duration: result.duration,
    variants: result.variants,
  });

  await s3App.send(
    new DeleteObjectCommand({
      Bucket: config.s3TempBucket,
      Key: payload.fileKey,
    }),
  );
};
