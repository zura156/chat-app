import { createClient, RedisClientType } from 'redis';
import { logger } from './logger';
import config from '../config/config';

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

export { redisClient, redisSubscriber };
