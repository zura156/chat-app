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

export const processUpload = async (job: Job<JobPayload>) => {
  const payload = job.data;

  // 1. fetch raw file stream from uploads-temp
  const s3Object = await s3App.send(
    new GetObjectCommand({
      Bucket: config.s3TempBucket,
      Key: payload.fileKey,
    }),
  );

  const fileStream = s3Object.Body as Readable;

  // 2. ClamAV scan
  const { isInfected, viruses } = await scanStream(fileStream);

  if (isInfected) {
    await moveToQuarantine(payload.fileKey, payload.uploadId, viruses);

    await emitToUser(payload.userId, {
      type: 'upload-infected',
      uploadId: payload.uploadId,
      context: payload.context,
      viruses,
    });

    return; // stop — don't process infected files
  }

  // 3. route to context handler
  const handlerConfig = contextHandlers[payload.context];
  if (!handlerConfig)
    throw new Error(`No handler for context: ${payload.context}`);

  const result = await handlerConfig.handler(payload);

  // 4. update upload record
  await Upload.findByIdAndUpdate(payload.uploadId, {
    status: 'ready',
    variants: result.variants,
  });

  // 5. context-specific side effect
  await handlerConfig.onComplete(payload, result);

  await emitToUser(payload.userId, {
    type: 'upload-ready',
    uploadId: payload.uploadId,
    context: payload.context,
    variants: result.variants,
  });
};
