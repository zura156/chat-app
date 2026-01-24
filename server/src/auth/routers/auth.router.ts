import { Response, NextFunction, Router } from 'express';
import {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  getCSRFToken,
  refreshToken,
  logOut,
  verifyEmail,
  unlockAccount,
} from '../controllers/auth.controller';

import { body } from 'express-validator';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware';
import { rateLimit } from 'express-rate-limit';
import { unauthenticatedGuard } from '../middlewares/unauthenticated.middleware';
import config from '../../config/config';

const router = Router();

// Rename for clarity
const authOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const csrfTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // reasonable for unauthenticated CSRF requests
  message: 'Too many CSRF token requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const authenticatedUserLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

// Dynamic limiter stays same, just update references
function dynamicCsrfRateLimiter(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  return req.user
    ? authenticatedUserLimiter(req, res, next)
    : csrfTokenLimiter(req, res, next);
}

const validateRegistration = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage(
      'Password must contain uppercase, lowercase, number and special character',
    ),
];

const validateLogin = [
  body('email').isEmail().normalizeEmail(),
  body('password').exists().withMessage('Password required'),
];

// Public routes
router.post(
  '/register',
  authOperationsLimiter,
  unauthenticatedGuard,
  validateRegistration,
  registerUser,
);
router.post(
  '/login',
  authOperationsLimiter,
  unauthenticatedGuard,
  validateLogin,
  loginUser,
);
router.post('/logout', authOperationsLimiter, authenticateToken, logOut);

router.post('/forgot-password', authOperationsLimiter, forgotPassword);
router.post('/reset-password', authOperationsLimiter, resetPassword);
router.post('/verify-email', dynamicCsrfRateLimiter, verifyEmail);
router.post('/unlock-account', dynamicCsrfRateLimiter, unlockAccount);
router.get(
  '/csrf-token',
  config.nodeEnv === 'production'
    ? dynamicCsrfRateLimiter
    : (next: NextFunction) => next(),
  getCSRFToken,
);
router.post('/refresh', dynamicCsrfRateLimiter, refreshToken);

export default router;
