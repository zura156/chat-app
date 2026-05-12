import { Request, Response, NextFunction, Router } from 'express';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../config/redis';
import { presign, confirm } from './upload.controller';

const router = Router();

let _presignLimiter: ReturnType<typeof rateLimit> | null = null;

function getPresignLimiter() {
  if (!_presignLimiter) {
    _presignLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many upload requests' },
      store: new RedisStore({
        sendCommand: (...args: string[]) => redisClient.sendCommand(args),
      }),
    });
  }
  return _presignLimiter;
}

const presignLimiter = (req: Request, res: Response, next: NextFunction) =>
  getPresignLimiter()(req, res, next);

//* /upload
router.post('/presign', presignLimiter, presign);
router.post('/confirm', confirm);

export default router;
