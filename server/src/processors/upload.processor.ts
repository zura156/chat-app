import { Job } from 'bullmq';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { contextHandlers } from './handlers';
import { Upload } from '../upload/upload.model';
import { s3App } from '../config/s3';
import { scanStream } from '../utils/clamav';
import { moveToQuarantine } from '../utils/quarantine';
import { JobPayload } from './handlers/types';
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
  });

  await handlerConfig.onComplete(payload, result);

  await emitToUser(payload.userId, {
    type: 'upload-ready',
    uploadId: payload.uploadId,
    context: payload.context,
    variants: result.variants,
    duration: result.duration,
  });
};
