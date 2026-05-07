import 'dotenv/config';
import { Worker, QueueEvents } from 'bullmq';
import { bullMQConnection } from './config/queue';
import { processUpload } from './processors/upload.processor';
import { logger } from './utils/logger';

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? '2');
// Keep low: ffmpeg is CPU-heavy. Scale horizontally via Coolify replicas instead.

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
  logger.error(JSON.stringify({ jobId: id, err }), 'Job failed');
});
worker.on('error', (err) =>
  logger.error(JSON.stringify({ err }), 'Worker error'),
);

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
