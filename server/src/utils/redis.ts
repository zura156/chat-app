import { createClient, RedisClientType } from 'redis';
import { logger } from './logger';

const redisClient: RedisClientType = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
  password: process.env.REDIS_PASSWORD,
});

const redisSubscriber: RedisClientType = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
  password: process.env.REDIS_PASSWORD,
});

redisClient.on('error', (err: any) => logger.error('Redis error:', err));
redisSubscriber.on('error', (err) => logger.error('Redis sub error:', err));

redisClient.on('ready', () => logger.info('Redis connected'));
redisSubscriber.on('ready', () => logger.info('Redis sub connected'));

export async function connectRedis(): Promise<void> {
  await Promise.all([redisClient.connect(), redisSubscriber.connect()]);
}

export { redisClient, redisSubscriber };
