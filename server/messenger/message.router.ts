import express from 'express';
import { sendMessage } from './controllers/message.controller';
import {
  createConversation,
  deleteConversation,
  getConversationById,
  getConversations,
  updateConversation,
} from './controllers/conversation.controller';
import { authenticate } from '../auth/middlewares/auth.middleware';

const router = express.Router();

router.post('/send', authenticate, sendMessage);
router
  .route('/conversation')
  .get(authenticate, getConversations)
  .post(authenticate, createConversation);

router
  .route('/conversation/:id')
  .get(authenticate, getConversationById)
  .patch(authenticate, updateConversation)
  .delete(authenticate, deleteConversation);

export default router;
