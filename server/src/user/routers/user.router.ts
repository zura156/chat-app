import { Router } from 'express';
import {
  deleteUser,
  getCurrentUser,
  getUserById,
  getUsers,
  searchUsers,
  updateUserDetails,
  updateProfilePicture,
} from '../controllers/user.controller';
import { upload } from '../../utils/multer';

const router = Router();

router
  .route('/profile')
  .get(getCurrentUser)
  .patch(updateUserDetails)
  .delete(deleteUser);
router
  .route('/profile-picture')
  .patch(upload.single('profilePicture'), updateProfilePicture);

router.get('/', getUsers);
router.get('/search', searchUsers);
router.get('/:id', getUserById);

export default router;
