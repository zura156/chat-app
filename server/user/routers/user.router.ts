import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import {
  deleteUser,
  getCurrentUser,
  updateUserDetails,
} from '../controllers/user.controller';

const router = Router();

router.get('/profile', authenticate, getCurrentUser);
router.patch('/profile/update', authenticate, updateUserDetails);
router.delete('/profile/delete', authenticate, deleteUser);

export default router;
