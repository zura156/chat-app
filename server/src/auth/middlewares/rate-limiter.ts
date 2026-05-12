import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../../config/redis';

interface RateLimitConfig {
  keyPrefix: string;
  limits: {
    attempts: number;
    windowMs: number;
    cooldownMs: number;
  }[];
  keyGenerator?: (req: Request) => string;
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
      const cooldownTTL = await redisClient.ttl(cooldownKey);
      if (cooldownTTL > 0) {
        res
          .status(429)
          .json({
            message: 'Too many requests. Please try again later.',
            retryAfter: cooldownTTL,
          });
        return;
      }
      (req as any).rateLimitKey = { attemptsKey, cooldownKey };
      next();
    } catch {
      next();
    }
  };
}

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

      const triggered = config.limits
        .sort((a, b) => b.attempts - a.attempts)
        .find((l) => newAttempts >= l.attempts);

      if (triggered) {
        await redisClient.setEx(cooldownKey, triggered.cooldownMs / 1000, '1');
        res.status(429).json({
          message: `Too many attempts. Wait ${triggered.cooldownMs / 1000 / 60} minutes.`,
          retryAfter: triggered.cooldownMs / 1000,
        });
        return;
      }

      next();
    } catch {
      next();
    }
  };
}

export function clearRateLimit() {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { attemptsKey, cooldownKey } = (req as any).rateLimitKey || {};
    if (attemptsKey) await redisClient.del([attemptsKey, cooldownKey]);
    next();
  };
}

const loginRateLimitConfig: RateLimitConfig = {
  keyPrefix: 'login',
  limits: [
    { attempts: 15, windowMs: 15 * 60 * 1000, cooldownMs: 30 * 60 * 1000 },
    { attempts: 10, windowMs: 15 * 60 * 1000, cooldownMs: 15 * 60 * 1000 },
    { attempts: 5, windowMs: 15 * 60 * 1000, cooldownMs: 5 * 60 * 1000 },
  ],
  keyGenerator: (req) => `${req.body.email}:${req.ip}`,
};

const forgotPasswordRateLimitConfig: RateLimitConfig = {
  keyPrefix: 'forgot',
  limits: [
    { attempts: 5, windowMs: 15 * 60 * 1000, cooldownMs: 30 * 60 * 1000 },
    { attempts: 3, windowMs: 15 * 60 * 1000, cooldownMs: 15 * 60 * 1000 },
  ],
  keyGenerator: (req) => `${req.body.email || req.ip}`,
};

export const loginRateLimiter = createRateLimiter(loginRateLimitConfig);
export const loginRateLimitIncrement = incrementRateLimit(loginRateLimitConfig);

export const forgotPasswordRateLimiter = createRateLimiter(
  forgotPasswordRateLimitConfig,
);
export const forgotPasswordRateLimitIncrement = incrementRateLimit(
  forgotPasswordRateLimitConfig,
);

export const clearRateLimitMiddleware = clearRateLimit();
