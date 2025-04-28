import express from 'express';
import { getMessagesByConversationId } from './controllers/message.controller';
import {
  createConversation,
  deleteConversation,
  getConversationById,
  getConversations,
  searchConversations,
  updateConversation,
} from './controllers/conversation.controller';
import { authenticate } from '../auth/middlewares/auth.middleware';
import { markNotificationsAsSeen } from './controllers/notifications.controller';

const router = express.Router();

router.post('/:conversationId/read', authenticate, markNotificationsAsSeen);
router.get(
  '/conversation/:conversationId/messages',
  authenticate,
  getMessagesByConversationId
);

router
  .route('/conversation')
  .get(authenticate, getConversations)
  .post(authenticate, createConversation);

router.route('/conversation/search').get(authenticate, searchConversations);

router
  .route('/conversation/:id')
  .get(authenticate, getConversationById)
  .patch(authenticate, updateConversation)
  .delete(authenticate, deleteConversation);

export default router;
