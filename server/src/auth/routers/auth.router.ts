import { Router } from 'express';
import {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  getCSRFToken,
  refreshToken,
  logOut,
} from '../controllers/auth.controller';

import { body } from 'express-validator';
import { authenticateToken } from '../middlewares/auth.middleware';
import { validateCSRF } from '../services/csrf.service';

const router = Router();

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
router.post('/register', validateCSRF, validateRegistration, registerUser);
router.post('/login', validateCSRF, validateLogin, loginUser);
router.post('/logout', authenticateToken, logOut);

router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/csrf-token', getCSRFToken);
router.post('/refresh', refreshToken);

export default router;
