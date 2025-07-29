import { Router } from 'express';
import {
  deleteUser,
  getCurrentUser,
  getUserById,
  getUsers,
  searchUsers,
  updateUserDetails,
} from '../controllers/user.controller';

const router = Router();

router.route('/profile').get(getCurrentUser);
router.patch('/profile/update', updateUserDetails);
router.delete('/profile/delete', deleteUser);

router.get('/', getUsers);
router.get('/search', searchUsers);
router.get('/:id', getUserById);

export default router;
