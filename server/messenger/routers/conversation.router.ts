import { Router } from 'express';
import { authenticate } from '../../auth/middlewares/auth.middleware';
import { ConversationController } from '../controllers/conversation.controller';
import { ConversationService } from '../services/conversation.service';

const router = Router();

router.use((req, res, next) => {
  if (!req.conversationService) {
    req.conversationService = new ConversationService();
  }
  if (!req.conversationController) {
    req.conversationController = new ConversationController(
      req.conversationService
    );
  }
  next();
});

// All routes in this file are protected
router.use(authenticate);

// --- Conversation Routes ---
router
  .route('/')
  .get((req, res, next) =>
    req.conversationController.getConversations(req, res, next)
  )
  .post((req, res, next) =>
    req.conversationController.createConversation(req, res, next)
  );

router.get('/search', (req, res, next) =>
  req.conversationController.searchConversations(req, res, next)
);

router
  .route('/:id')
  .get((req, res, next) =>
    req.conversationController.getConversationById(req, res, next)
  )
  .patch((req, res, next) =>
    req.conversationController.updateConversation(req, res, next)
  )
  .delete((req, res, next) =>
    req.conversationController.deleteConversation(req, res, next)
  );

export default router;
