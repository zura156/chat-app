import { Router } from 'express';
import { MessageController } from '../controllers/message.controller';
import { MessageService } from '../services/message.service';
import { uploadMiddleware } from '../../config/multer'; // Import your multer config

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

router.get('/:conversationId/messages', (req, res, next) =>
  req.messageController.getMessagesByConversationId(req, res, next)
);

router.post('/upload', uploadMiddleware.single('file'), (req, res, next) =>
  req.messageController.uploadFileMessage(req, res, next)
);

export default router;
