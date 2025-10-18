import { Router } from 'express';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { ConversationController } from '../controllers/conversation.controller';
import { ConversationService } from '../services/conversation.service';
import { validateConversation } from '../middlewares/validate-conversation.middleware';
import { MessageService } from '../services/message.service';

const router = Router();

// Dependency Injection
router.use((req, res, next) => {
  const broadcastMessage = req.app.get('broadcastMessage');
  if (!req.messageService) {
    req.messageService = new MessageService(broadcastMessage);
  }
  if (!req.conversationService) {
    req.conversationService = new ConversationService(
      broadcastMessage,
      req.messageService
    );
  }
  if (!req.conversationController) {
    req.conversationController = new ConversationController(
      req.conversationService
    );
  }
  next();
});

// --- Routes ---
router
  .route('/')
  .get((req, res, next) =>
    req.conversationController.getConversations(req, res, next)
  )
  .post((req, res, next) =>
    req.conversationController.createConversation(req, res, next)
  );

router.get('/find/:participantId', (req, res, next) =>
  req.conversationController.findConversationIdByUserId(req, res, next)
);

router.get('/search', (req, res, next) =>
  req.conversationController.searchConversations(req, res, next)
);

router
  .route('/:id/members')
  .all(validateConversation)
  .patch((req, res, next) =>
    req.conversationController.manageConversationMembers(req, res, next)
  );

router
  .route('/:id')
  .all(validateConversation)
  .get(async (req: AuthRequest, res) => {
    const conversation = await req.conversation?.populate(
      'participants',
      'first_name last_name username profile_picture status last_seen'
    );

    const otherParticipants = conversation?.participants.filter(
      (p: any) => p._id.toString() !== req.user?.id
    );

    const conversationWithFilteredParticipants = {
      ...conversation?.toObject(),
      participants: otherParticipants,
    };

    res.json(conversationWithFilteredParticipants);
  })
  .patch(
    // uploadMiddleware.single('group_picture'),
    (req, res, next) =>
      req.conversationController.updateConversation(req, res, next)
  )
  .delete((req, res, next) =>
    req.conversationController.deleteConversation(req, res, next)
  );

export default router;
