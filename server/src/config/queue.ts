import { Queue } from 'bullmq';
import config from './config';

const bullMQConnection = {
  host: config.redisHost,
  port: config.redisPort,
  password: config.redisPassword,
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false, // required by BullMQ
  lazyConnect: false,
};

export const uploadQueue = new Queue('media-processing', {
  connection: bullMQConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400, count: 5000 },
  },
});

export { bullMQConnection }; // re-use in Worker, QueueEvents, etc.
