import { Router } from 'express';
import { MessageController } from '../controllers/message.controller';
import { MessageService } from '../services/message.service';
import { uploadMiddleware } from '../../config/multer'; // Import your multer config
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

router.get(
  '/:conversationId/messages',
  validateConversation,
  (req, res, next) =>
    req.messageController.getMessagesByConversationId(req, res, next)
);
router.get('/:conversationId/media', validateConversation, (req, res, next) =>
  req.messageController.getMediaMessages(req, res, next)
);

router.get('/:conversationId/files', validateConversation, (req, res, next) =>
  req.messageController.getFileMessages(req, res, next)
);

router.post('/upload', uploadMiddleware.single('file'), (req, res, next) =>
  req.messageController.uploadFileMessage(req, res, next)
);

export default router;
