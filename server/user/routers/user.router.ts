import { Router } from 'express';
import { authenticate } from '../../auth/middlewares/auth.middleware';
import {
  deleteUser,
  getCurrentUser,
  getUsers,
  searchUsers,
  updateUserDetails,
} from '../controllers/user.controller';

const router = Router();

router.route('/profile').get(authenticate, getCurrentUser);
router.patch('/profile/update', authenticate, updateUserDetails);
router.delete('/profile/delete', authenticate, deleteUser);

router.get('/', authenticate, getUsers);
router.get('/search', authenticate, searchUsers);

export default router;
