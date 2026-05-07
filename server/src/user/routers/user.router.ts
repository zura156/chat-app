import { Router } from 'express';
import {
  deleteUser,
  getCurrentUser,
  getUserById,
  getUsers,
  searchUsers,
  updateUserDetails,
} from '../controllers/user.controller';
import { upload } from '../../utils/multer';

const router = Router();

router
  .route('/profile')
  .get(getCurrentUser)
  .patch(updateUserDetails)
  .delete(deleteUser);

router.get('/', getUsers);
router.get('/search', searchUsers);
router.get('/:id', getUserById);

export default router;
