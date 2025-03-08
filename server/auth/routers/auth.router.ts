import { Router } from 'express';
import {
  registerUser,
  loginUser,
  getCurrentUser,
  refreshToken,
} from '../controllers/auth.controller';
import { authenticate, authorize } from '../../middlewares/auth.middleware';

const router = Router();

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected routes
router.get('/me', authenticate, getCurrentUser);
router.post('/refresh-token', authenticate, refreshToken);

export default router;
