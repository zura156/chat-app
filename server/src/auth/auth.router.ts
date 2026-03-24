import { Router } from 'express';
import {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  refreshAccessToken,
  logOut,
  verifyEmail,
  unlockAccount,
  getCsrfToken,
} from './auth.controller';
import { body } from 'express-validator';
import { authenticateToken } from './middlewares/auth.middleware';
import { unauthenticatedGuard } from './middlewares/unauthenticated.middleware';
import {
  loginRateLimiter,
  forgotPasswordRateLimiter,
} from './middlewares/rate-limiter';
import { csrfProtection } from './middlewares/csrf.middleware';

const router = Router();

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

router.get('/csrf-token', getCsrfToken);
router.post(
  '/register',
  unauthenticatedGuard,
  csrfProtection,
  validateRegistration,
  registerUser,
);
router.post(
  '/login',
  loginRateLimiter,
  unauthenticatedGuard,
  csrfProtection,
  validateLogin,
  loginUser,
);
router.post('/logout', authenticateToken, csrfProtection, logOut);
router.post(
  '/forgot-password',
  forgotPasswordRateLimiter,
  csrfProtection,
  forgotPassword,
);
router.post('/reset-password', csrfProtection, resetPassword);
router.post('/verify-email', verifyEmail);
router.post('/unlock-account', unlockAccount);
router.post('/refresh', refreshAccessToken);

export default router;
