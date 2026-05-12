import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';
import config from './config';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request, Response, NextFunction } from 'express';

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

let _limiter: ReturnType<typeof rateLimit> | null = null;
let _presignLimiter: ReturnType<typeof rateLimit> | null = null;

export function initLimiters(): void {
  _limiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      prefix: 'rl_general:',
      sendCommand: (...args: string[]) => redisClient.sendCommand(args),
    }),
  });

  _presignLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many upload requests' },
    store: new RedisStore({
      prefix: 'rl_presign:',
      sendCommand: (...args: string[]) => redisClient.sendCommand(args),
    }),
  });
}

export const generalLimiter = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!_limiter) return next(); // fallback: skip limiting if not yet initialized (shouldn't happen)
  _limiter(req, res, next);
};
export const presignLimiter = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!_presignLimiter) return next();
  _presignLimiter(req, res, next);
};

export { redisClient, redisSubscriber };
