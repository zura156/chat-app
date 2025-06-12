import express from 'express';
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
import { MessageController } from './controllers/message.controller';
import { MessageService } from './services/message.service';

const router = express.Router();

router.use((req, res, next) => {
  const broadcastMessage = req.app.get('broadcastMessage');

  // We only need one instance of each per request.
  if (!req.messageService) {
    req.messageService = new MessageService(broadcastMessage);
  }
  if (!req.messageController) {
    req.messageController = new MessageController(req.messageService);
  }
  next();
});

router.post('/:conversationId/read', authenticate, markNotificationsAsSeen);
router.get(
  '/conversation/:conversationId/messages',
  authenticate,
  (req, res, next) =>
    req.messageController.getMessagesByConversationId(req, res, next)
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

declare global {
  namespace Express {
    export interface Request {
      messageController: MessageController;
      messageService: MessageService;
    }
  }
}
