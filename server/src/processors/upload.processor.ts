import { Job } from 'bullmq';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  UploadJobData,
  QUARANTINE_BUCKET,
  PRIVATE_BUCKET,
  PUBLIC_BUCKET,
} from '../config/upload.config';
import { s3App, s3Quarantine } from '../utils/s3';
import {
  downloadFromQuarantine,
  uploadToApp,
  deleteFromQuarantine,
  copyQuarantineToApp,
} from '../upload/s3-transfer.service';
import { processImage } from './handlers/image.handler';
import { processVideo } from './handlers/video.handler';
import { logger } from '../utils/logger';

const VIDEO_CONTEXTS = new Set(['dm-video', 'post-video', 'story']);
const IMAGE_CONTEXTS = new Set([
  'avatar',
  'group-avatar',
  'cover-photo',
  'dm-image',
  'post-image',
]);

export async function processUpload(job: Job<UploadJobData>) {
  const { fileId, key, userId, context, mimeType, originalName } = job.data;
  const tmpPath = path.join(os.tmpdir(), `${fileId}_${originalName}`);

  try {
    // 1. Verify file exists in quarantine
    await s3Quarantine.send(
      new HeadObjectCommand({ Bucket: QUARANTINE_BUCKET, Key: key }),
    );
    await job.updateProgress(10);

    // 2. Download to /tmp (needed for ffmpeg/sharp)
    await downloadFromQuarantine(key, tmpPath);
    await job.updateProgress(30);

    const isVideo =
      mimeType.startsWith('video/') || VIDEO_CONTEXTS.has(context);
    const isImage =
      mimeType.startsWith('image/') || IMAGE_CONTEXTS.has(context);

    let resultKey: string;

    if (isVideo) {
      // 3a. Transcode to HLS → HLS_BUCKET
      const hlsPrefix = `hls/${userId}/${fileId}`;
      const masterKey = await processVideo(tmpPath, hlsPrefix);
      resultKey = masterKey;
      await job.updateProgress(85);
    } else if (isImage) {
      // 3b. Resize + convert to webp → PUBLIC_BUCKET
      const ext = originalName.split('.').pop();
      const destKey = `media/${context}/${userId}/${fileId}.webp`;
      await processImage(tmpPath, destKey, context as any);
      resultKey = destKey;
      await job.updateProgress(85);
    } else {
      // 3c. Raw file (dm-file etc.) → PRIVATE_BUCKET, just copy
      const destKey = `files/${userId}/${fileId}/${originalName}`;
      await copyQuarantineToApp(key, destKey);
      resultKey = destKey;
      await job.updateProgress(85);
    }

    // 4. Update DB (replace with your ORM)
    await updateFileRecord(fileId, { status: 'ready', key: resultKey });

    // 5. Delete from quarantine AFTER DB write (safe to re-run)
    await deleteFromQuarantine(key);

    await job.updateProgress(100);
    logger.info(
      JSON.stringify({ fileId, context, resultKey }),
      'Upload processed',
    );

    return { fileId, key: resultKey };
  } catch (err) {
    logger.error(JSON.stringify({ fileId, err }), 'processUpload failed');
    throw err; // BullMQ will retry per job options
  } finally {
    // Always cleanup /tmp regardless of success/failure
    await fs.rm(tmpPath, { force: true });
  }
}

async function updateFileRecord(fileId: string, data: Record<string, unknown>) {
  // TODO: replace with your db call
  // await db.upload.update({ where: { id: fileId }, data })
}
