import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../../utils/redis';

interface RateLimitConfig {
  keyPrefix: string;
  limits: {
    attempts: number;
    windowMs: number;
    cooldownMs: number;
  }[];
  keyGenerator?: (req: Request) => string;
  skipSuccessful?: boolean;
}

export function createRateLimiter(config: RateLimitConfig) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const key = config.keyGenerator
      ? config.keyGenerator(req)
      : `${req.body.email || req.ip}`;

    const attemptsKey = `${config.keyPrefix}:attempts:${key}`;
    const cooldownKey = `${config.keyPrefix}:cooldown:${key}`;

    try {
      // Check cooldown
      const cooldownTTL = await redisClient.ttl(cooldownKey);
      if (cooldownTTL > 0) {
        res.status(429).json({
          message: 'Too many requests. Please try again later.',
          retryAfter: cooldownTTL,
        });
        return;
      }

      const attemptsStr = await redisClient.get(attemptsKey);
      const attempts = parseInt(attemptsStr || '0');

      (req as any).rateLimitKey = { attemptsKey, cooldownKey };
      (req as any).rateLimitAttempts = attempts;

      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      next();
    }
  };
}

// Middleware to increment on failure
export function incrementRateLimit(config: RateLimitConfig) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { attemptsKey, cooldownKey } = (req as any).rateLimitKey || {};

    if (!attemptsKey) {
      next();
      return;
    }

    try {
      const newAttempts = await redisClient.incr(attemptsKey);
      await redisClient.expire(
        attemptsKey,
        Math.max(...config.limits.map((l) => l.windowMs / 1000)),
      );

      // Check limits and apply cooldowns
      for (const limit of config.limits.sort(
        (a, b) => b.attempts - a.attempts,
      )) {
        if (newAttempts >= limit.attempts) {
          await redisClient.setEx(cooldownKey, limit.cooldownMs / 1000, '1');
          res.status(429).json({
            message: `Too many attempts. Wait ${limit.cooldownMs / 1000 / 60} minutes.`,
            retryAfter: limit.cooldownMs / 1000,
          });
          return;
        }
      }

      next();
    } catch (error) {
      console.error('Increment rate limit error:', error);
      next();
    }
  };
}

// Middleware to clear on success
export function clearRateLimit() {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { attemptsKey, cooldownKey } = (req as any).rateLimitKey || {};

    if (attemptsKey) {
      await redisClient.del(attemptsKey);
      await redisClient.del(cooldownKey);
    }

    next();
  };
}

const loginRateLimitConfig = {
  keyPrefix: 'login',
  limits: [
    { attempts: 15, windowMs: 15 * 60 * 1000, cooldownMs: 30 * 60 * 1000 }, // 15 attempts = 30min cooldown
    { attempts: 10, windowMs: 15 * 60 * 1000, cooldownMs: 15 * 60 * 1000 }, // 10 attempts = 15min cooldown
    { attempts: 5, windowMs: 15 * 60 * 1000, cooldownMs: 5 * 60 * 1000 }, // 5 attempts = 5min cooldown
  ],
  keyGenerator: (req: Request) => `${req.body.email}:${req.ip}`,
};

export const loginRateLimiter = createRateLimiter(loginRateLimitConfig);
export const loginRateLimitIncrement = incrementRateLimit(loginRateLimitConfig);
