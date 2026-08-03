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
      req.messageService,
    );
  }
  if (!req.conversationController) {
    req.conversationController = new ConversationController(
      req.conversationService,
    );
  }
  next();
});

// --- Routes ---
router
  .route('/')
  .get((req, res, next) =>
    req.conversationController.getConversations(req, res, next),
  )
  .post((req, res, next) =>
    req.conversationController.createConversation(req, res, next),
  );

router.get('/find/:participantId', (req, res, next) =>
  req.conversationController.findConversationIdByUserId(req, res, next),
);

router.get('/search', (req, res, next) =>
  req.conversationController.searchConversations(req, res, next),
);

// Declared before '/:id' so the literal wins the match.
router.get('/muted', (req, res, next) =>
  req.conversationController.getMutedConversations(req, res, next),
);

router
  .route('/:id/members')
  .all(validateConversation)
  .patch((req, res, next) =>
    req.conversationController.manageConversationMembers(req, res, next),
  );

// The service and controller for these existed, but nothing routed to them —
// so a mute was honoured everywhere and could never actually be set.
router
  .route('/:id/mute')
  .all(validateConversation)
  .post((req, res, next) =>
    req.conversationController.muteConversation(req, res, next),
  )
  .delete((req, res, next) =>
    req.conversationController.unmuteConversation(req, res, next),
  );

router
  .route('/:id')
  .all(validateConversation)
  .get(async (req: AuthRequest, res) => {
    const conversation = await req.conversation?.populate(
      'participants',
      'first_name last_name username pfp_url pfp_variants status last_seen',
    );

    const otherParticipants = conversation?.participants.filter(
      (p: any) => p._id.toString() !== req.user?._id.toString(),
    );

    const conversationWithFilteredParticipants = {
      ...conversation?.toObject(),
      participants: otherParticipants,
    };

    res.json(conversationWithFilteredParticipants);
  })
  .patch((req, res, next) =>
    req.conversationController.updateConversation(req, res, next),
  )
  .delete((req, res, next) =>
    req.conversationController.deleteConversation(req, res, next),
  );

export default router;
