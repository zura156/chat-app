import 'dotenv/config';
import { Worker, QueueEvents } from 'bullmq';
import { bullMQConnection } from './config/queue';
import { processUpload } from './processors/upload.processor';
import { logger } from './utils/logger';
import { connectDB } from './config/db';
import { connectRedis } from './config/redis';

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? '2');
// Keep low: ffmpeg is CPU-heavy. Scale horizontally via Coolify replicas instead.

async function startWorker() {
  try {
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

    worker.on('completed', ({ id }) =>
      logger.info(JSON.stringify({ jobId: id }), 'Job completed'),
    );
    worker.on('failed', (job, err) => {
      const id = job?.id;
      // MANUALLY extract properties because Error objects don't stringify
      const errorInfo = {
        message: err.message,
        name: err.name,
        stack: err.stack,
        // S3 specific errors often have these:
        code: (err as any).Code || (err as any).name,
        status: (err as any).$metadata?.httpStatusCode,
      };

      console.error('Job failed, Raw error:', err);
      logger.error('Job failed', { jobId: id, error: errorInfo });
    });

    worker.on('error', (err) => {
      console.error('Job failed, Raw error:', err);

      logger.error('Worker error', {
        err: { message: err.message, stack: err.stack },
      });
    });
    events.on('stalled', ({ jobId }) =>
      logger.warn(JSON.stringify({ jobId }), 'Job stalled'),
    );

    // Graceful shutdown — Coolify sends SIGTERM on redeploy
    async function shutdown() {
      logger.info('Shutting down worker...');
      await worker.close();
      process.exit(0);
    }

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    logger.info(JSON.stringify({ concurrency: CONCURRENCY }), 'Worker started');
  } catch (error) {
    logger.error('Worker failed to start', error);
    console.error('Worker failed to start, Raw error:', error);
    process.exit(1);
  }
}

startWorker();
