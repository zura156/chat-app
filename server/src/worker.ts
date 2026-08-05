import 'dotenv/config';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'child_process';
import { Worker, QueueEvents } from 'bullmq';
import { bullMQConnection } from './config/queue';
import {
  discardTempObject,
  processUpload,
} from './processors/upload.processor';
import { logger } from './utils/logger';
import { connectDB } from './config/db';
import { connectRedis } from './config/redis';
import { Upload } from './upload/upload.model';
import {
  markAttachmentStatus,
  notifyAttachmentOutcome,
} from './utils/attachment-status';
import config from './config/config';

// Keep low: ffmpeg is CPU-heavy. Scale horizontally via Coolify replicas instead.

const CONCURRENCY = config.workerConcurrency;

/**
 * This is the process that actually transcodes — the paths used to be set in
 * index.ts (the API), which does none, leaving the worker dependent on whatever
 * happened to be on $PATH.
 *
 * ffmpeg comes from the `ffmpeg-static` dependency so it works without a system
 * install. ffprobe has no such package and must be on PATH (both Dockerfiles
 * apt-install ffmpeg, which provides it) — verified here so a missing binary
 * fails loudly at boot instead of failing every job later.
 */
function configureFfmpeg(): void {
  if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
    logger.info(`ffmpeg binary: ${ffmpegPath}`);
  } else {
    logger.warn('ffmpeg-static provided no binary; falling back to $PATH');
  }

  execFile('ffprobe', ['-version'], (error) => {
    if (error) {
      logger.error(
        'ffprobe not found on PATH — media duration extraction will fail. Install ffmpeg in this image.',
      );
    }
  });
}

async function startWorker() {
  try {
    configureFfmpeg();

    await connectDB();

    await connectRedis();

    const worker = new Worker('media-processing', processUpload, {
      connection: bullMQConnection,
      concurrency: CONCURRENCY,
      lockDuration: 5 * 60 * 1000, // 5 min — videos can take a while
      lockRenewTime: 60 * 1000, // renew lock every 60s during processing
    });

    const events = new QueueEvents('media-processing', {
      connection: bullMQConnection,
    });

    worker.on('completed', ({ id }) => logger.info('Job completed', { jobId: id }));
    worker.on('failed', async (job, err) => {
      const id = job?.id;
      // NOTE: the Upload document is keyed by uploadId, not by the BullMQ job id
      const uploadId = job?.data?.uploadId;
      // MANUALLY extract properties because Error objects don't stringify
      const errorInfo = {
        message: err.message,
        name: err.name,
        stack: err.stack,
        // S3 specific errors often have these:
        code: (err as any).Code || (err as any).name,
        status: (err as any).$metadata?.httpStatusCode,
      };

      // update the database — only once the job has exhausted its retries,
      // otherwise a transient failure marks a still-pending upload as failed
      const isFinalAttempt =
        !job || job.attemptsMade >= (job.opts?.attempts ?? 1);

      if (uploadId && isFinalAttempt) {
        await Upload.findByIdAndUpdate(uploadId, { status: 'failed' }).exec();
        await markAttachmentStatus(uploadId, 'failed');

        // Nothing will retry this job, so nothing else will ever remove the
        // original it left in the temp bucket.
        const fileKey = job?.data?.fileKey;
        if (fileKey) await discardTempObject(fileKey);

        // notify the client that the upload failed, so it can update its UI
        await notifyAttachmentOutcome(uploadId, {
          type: 'upload-failed',
          uploadId,
          context: job?.data?.context,
        });
      }

      logger.error('Job failed', { jobId: id, uploadId, error: errorInfo });
    });

    worker.on('error', (err) => {
      logger.error('Worker error', {
        err: { message: err.message, stack: err.stack },
      });
    });
    events.on('stalled', ({ jobId }) => logger.warn('Job stalled', { jobId }));

    // Graceful shutdown — Coolify sends SIGTERM on redeploy
    async function shutdown() {
      logger.info('Shutting down worker...');
      await Promise.allSettled([worker.close(), events.close()]);
      process.exit(0);
    }

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    logger.info('Worker started', { concurrency: CONCURRENCY });
  } catch (error) {
    logger.error('Worker failed to start', error);
    process.exit(1);
  }
}

startWorker();
