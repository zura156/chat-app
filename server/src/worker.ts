import 'dotenv/config';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'child_process';
import { Worker, QueueEvents, Job } from 'bullmq';
import { JobPayload } from './processors/handlers/types';
import { bullMQConnection } from './config/queue';
import {
  discardTempObject,
  processUpload,
} from './processors/upload.processor';
import { isFinalAttempt } from './processors/final-attempt';
import { logger } from './utils/logger';
import { connectDB } from './config/db';
import { connectRedis } from './config/redis';
import { Upload } from './upload/upload.model';
import {
  markAttachmentStatus,
  notifyAttachmentOutcome,
} from './utils/attachment-status';
import config from './config/config';
import {
  CANARY_SWEEP_EVERY_MS,
  sweepCanaryUploads,
} from './upload/canary-sweep.service';

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
      try {
        await handleFailedJob(job, err);
      } catch (handlerError) {
        // Nothing awaits this listener, so a throw here is an unhandled
        // rejection — and the process-level handler below is the only thing
        // between that and a dead worker.
        logger.error('Failed-job handler threw', handlerError);
      }
    });

    worker.on('error', (err) => {
      logger.error('Worker error', {
        err: { message: err.message, stack: err.stack },
      });
    });
    events.on('stalled', ({ jobId }) => logger.warn('Job stalled', { jobId }));

    const sweep = startCanarySweep();

    // Graceful shutdown — Coolify sends SIGTERM on redeploy
    async function shutdown() {
      logger.info('Shutting down worker...');
      if (sweep) clearInterval(sweep);
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

/**
 * Sweeps the upload canary's finished uploads every hour, once at start so a
 * redeploy doesn't put it off (`upload/canary-sweep.service.ts`). A timer in
 * this process rather than a BullMQ repeatable job: a job would sit in the
 * `media-processing` queue that sentinel's worker check reads for stuck jobs.
 *
 * Off unless CANARY_USER_ID holds an ObjectId; the start line says which.
 */
function startCanarySweep(): NodeJS.Timeout | undefined {
  const userId = config.canaryUserId;
  if (!userId) {
    logger.info('Canary sweep off (CANARY_USER_ID unset or not an ObjectId)');
    return undefined;
  }

  const run = async () => {
    try {
      const removed = await sweepCanaryUploads(userId);
      if (removed > 0) logger.info('Canary sweep removed uploads', { removed });
    } catch (error) {
      // Nothing awaits a timer callback: a throw here would be an unhandled
      // rejection (see the handlers at the bottom of this file).
      logger.error('Canary sweep failed', error);
    }
  };

  logger.info('Canary sweep on', { everyMinutes: CANARY_SWEEP_EVERY_MS / 60_000 });
  void run();
  return setInterval(run, CANARY_SWEEP_EVERY_MS);
}

/**
 * Records a permanently failed job: marks the upload, tells the conversation
 * the attachment is not coming, and removes the original nothing will retry.
 *
 * Extracted from the `failed` listener so its awaits have somewhere to be
 * caught. Which failures are final is `isFinalAttempt`'s call.
 */
async function handleFailedJob(
  job: Job<JobPayload> | undefined,
  err: Error,
): Promise<void> {
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

  // update the database — only once nothing will run the job again,
  // otherwise a transient failure marks a still-pending upload as failed
  if (uploadId && isFinalAttempt(job, err)) {
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
}

/*
 * The API process has had these since it was found that one stray promise would
 * drop every websocket on the instance. The worker had nothing — and it is the
 * more exposed of the two, because its event listeners are `async` and nothing
 * awaits them: a Mongo blip while recording a failed job was an unhandled
 * rejection, and Node terminates on those by default.
 *
 * A dead worker is silent. Uploads keep being accepted and enqueued, every one
 * of them sits at `processing` forever, and the only symptom is attachments
 * that never arrive.
 */
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection in worker:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in worker:', error);
});

startWorker();
