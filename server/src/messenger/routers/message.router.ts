import { Router } from 'express';
import { MessageController } from '../controllers/message.controller';
import { MessageService } from '../services/message.service';
import { validateConversation } from '../middlewares/validate-conversation.middleware';

const router = Router();

// Dependency Injection
router.use((req, res, next) => {
  const broadcastMessage = req.app.get('broadcastMessage');
  if (!req.messageService) {
    req.messageService = new MessageService(broadcastMessage);
  }
  if (!req.messageController) {
    req.messageController = new MessageController(req.messageService);
  }
  next();
});

// --- Routes ---

router.post('/:id/send', validateConversation, (req, res, next) =>
  req.messageController.sendMessage(req, res, next),
);

router.get('/:id/messages', validateConversation, (req, res, next) =>
  req.messageController.getMessagesByConversationId(req, res, next),
);

// `:id` is the conversation, which validateConversation proves membership of;
// ownership of `:messageId` is checked in the service.
router
  .route('/:id/messages/:messageId')
  .all(validateConversation)
  .patch((req, res, next) =>
    req.messageController.editMessage(req, res, next),
  )
  .delete((req, res, next) =>
    req.messageController.deleteMessage(req, res, next),
  );
router.get('/:id/media', validateConversation, (req, res, next) =>
  req.messageController.getMediaMessages(req, res, next),
);

router.get('/:id/files', validateConversation, (req, res, next) =>
  req.messageController.getFileMessages(req, res, next),
);

export default router;
