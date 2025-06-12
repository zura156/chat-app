import { Router } from 'express';
import { authenticate } from '../../auth/middlewares/auth.middleware';
import { MessageController } from '../controllers/message.controller';
import { MessageService } from '../services/message.service';
import { uploadMiddleware } from '../../config/multer'; // Import your multer config

const router = Router();

// Dependency Injection Middleware for Message routes
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

// All routes in this file are protected
router.use(authenticate);

// --- Message Routes ---
router.get(
  // Note: The path is now relative to where it's mounted.
  '/:conversationId/messages',
  (req, res, next) =>
    req.messageController.getMessagesByConversationId(req, res, next)
);

router.post('/upload', uploadMiddleware.single('file'), (req, res, next) =>
  req.messageController.uploadFileMessage(req, res, next)
);

export default router;
