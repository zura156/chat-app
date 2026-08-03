import { Router } from 'express';
import {
  blockUser,
  deleteUser,
  getBlockedUsers,
  getCurrentUser,
  getPrivacySettings,
  getUserById,
  getUsers,
  searchUsers,
  unblockUser,
  updatePrivacySettings,
  updateUserDetails,
} from '../controllers/user.controller';
import {
  exportUserData,
  getStorageUsage,
} from '../controllers/storage.controller';

const router = Router();

router
  .route('/profile')
  .get(getCurrentUser)
  .patch(updateUserDetails)
  .delete(deleteUser);

router.get('/', getUsers);
router.get('/search', searchUsers);

// Before '/:id' so the literal wins the match.
router.get('/blocked', getBlockedUsers);
router
  .route('/privacy')
  .get(getPrivacySettings)
  .patch(updatePrivacySettings);

router.get('/storage', getStorageUsage);
router.get('/export', exportUserData);

router.route('/:id/block').post(blockUser).delete(unblockUser);

router.get('/:id', getUserById);

export default router;
