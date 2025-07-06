import { Router } from 'express';
import {
  registerUser,
  loginUser,
  refreshAccessToken,
} from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected routes
router.post('/refresh-token', authenticate, refreshAccessToken);

export default router;
