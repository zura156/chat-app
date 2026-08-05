import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';
import config from './config';

const redisClient: RedisClientType = createClient({
  socket: {
    host: config.redisHost || 'localhost',
    port: config.redisPort,
  },
  password: config.redisPassword,
});

const redisSubscriber: RedisClientType = createClient({
  socket: {
    host: config.redisHost || 'localhost',
    port: config.redisPort,
  },
  password: config.redisPassword,
});

redisClient.on('error', (err: any) => logger.error('Redis error:', err));
redisSubscriber.on('error', (err) => logger.error('Redis sub error:', err));

redisClient.on('ready', () => logger.info('Redis connected'));
redisSubscriber.on('ready', () => logger.info('Redis sub connected'));

export async function connectRedis(): Promise<void> {
  await Promise.all([redisClient.connect(), redisSubscriber.connect()]);
}

// The general and presign limiters used to live here. They are rate limiters,
// not Redis plumbing, and keeping them beside the per-identity ones is what
// makes the whole policy readable in one place: see auth/middlewares/rate-limiter.

export { redisClient, redisSubscriber };
