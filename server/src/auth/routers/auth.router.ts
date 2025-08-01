import { Request, Response, NextFunction, Router } from 'express';
import {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  getCSRFToken,
  refreshToken,
  logOut,
  verifyEmail,
} from '../controllers/auth.controller';

import { body } from 'express-validator';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware';
import { rateLimit } from 'express-rate-limit';
import { unauthenticatedGuard } from '../middlewares/unauthenticated.middleware';

const router = Router();

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many CSRF token requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const relaxedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // much higher for authenticated users
  standardHeaders: true,
  legacyHeaders: false,
});

function dynamicCsrfRateLimiter(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const isAuthenticated = !!req.user;

  return isAuthenticated
    ? relaxedLimiter(req, res, next)
    : strictLimiter(req, res, next);
}

const validateRegistration = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage(
      'Password must contain uppercase, lowercase, number and special character'
    ),
];

const validateLogin = [
  body('email').isEmail().normalizeEmail(),
  body('password').exists().withMessage('Password required'),
];

// Public routes
router.post(
  '/register',
  strictLimiter,
  unauthenticatedGuard,
  validateRegistration,
  registerUser
);
router.post(
  '/login',
  strictLimiter,
  unauthenticatedGuard,
  validateLogin,
  loginUser
);
router.post('/logout', strictLimiter, authenticateToken, logOut);

router.post('/forgot-password', strictLimiter, forgotPassword);
router.post('/reset-password', strictLimiter, resetPassword);
router.post('/verify-email', dynamicCsrfRateLimiter, verifyEmail);
router.get(
  '/csrf-token',
  // dynamicCsrfRateLimiter,
  getCSRFToken
);
router.post('/refresh', dynamicCsrfRateLimiter, refreshToken);

export default router;
