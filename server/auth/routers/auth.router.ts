import { Router } from 'express';
import {
  registerUser,
  loginUser,
  refreshToken,
} from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected routes
router.post('/refresh-token', authenticate, refreshToken);

export default router;
