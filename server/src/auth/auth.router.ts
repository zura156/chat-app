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
  getSessions,
  revokeSessionById,
  revokeAllSessions,
  loginTwoFactor,
} from './auth.controller';
import {
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  getTwoFactorStatus,
} from './two-factor.controller';
import { body } from 'express-validator';
import { authenticateToken } from './middlewares/auth.middleware';
import { unauthenticatedGuard } from './middlewares/unauthenticated.middleware';
import {
  loginRateLimiter,
  forgotPasswordRateLimiter,
} from './middlewares/rate-limiter';
import { csrfProtection } from './middlewares/csrf.middleware';
import { validateRequest } from './middlewares/validate-request.middleware';

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

router.post(
  '/register',
  unauthenticatedGuard,
  validateRegistration,
  validateRequest,
  registerUser,
);
router.post(
  '/login',
  loginRateLimiter,
  unauthenticatedGuard,
  validateLogin,
  validateRequest,
  loginUser,
);
// Second step of a two-factor sign-in. Rate limited like the first: it is a
// six-digit secret and brute force is the obvious attack.
router.post('/login/2fa', loginRateLimiter, loginTwoFactor);

// Enrolment lives behind a session — you must already be signed in to add,
// confirm or remove a second factor.
router.get('/2fa', authenticateToken, getTwoFactorStatus);
router.post('/2fa/setup', authenticateToken, csrfProtection, beginTwoFactorSetup);
router.post(
  '/2fa/confirm',
  authenticateToken,
  csrfProtection,
  confirmTwoFactorSetup,
);
router.delete('/2fa', authenticateToken, csrfProtection, disableTwoFactor);

router.post('/logout', authenticateToken, csrfProtection, logOut);

// Session management for the security screen. csrfProtection is applied per
// mutating route because this router sits ahead of the global one.
router.get('/sessions', authenticateToken, getSessions);
router.delete(
  '/sessions',
  authenticateToken,
  csrfProtection,
  revokeAllSessions,
);
router.delete(
  '/sessions/:id',
  authenticateToken,
  csrfProtection,
  revokeSessionById,
);
router.post('/forgot-password', forgotPasswordRateLimiter, forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/verify-email', verifyEmail);
router.post('/unlock-account', unlockAccount);
router.post('/refresh', refreshAccessToken);

export default router;
