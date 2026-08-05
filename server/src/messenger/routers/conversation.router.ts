import { Router } from 'express';
import { ConversationController } from '../controllers/conversation.controller';
import { validateConversation } from '../middlewares/validate-conversation.middleware';
import { getConversationController } from '../messenger.container';

const router = Router();

// Resolved once — see messenger.container for why this is not per-request.
const controller = (): ConversationController => getConversationController();

// --- Routes ---
router
  .route('/')
  .get((req, res, next) => controller().getConversations(req, res, next))
  .post((req, res, next) => controller().createConversation(req, res, next));

router.get('/find/:participantId', (req, res, next) =>
  controller().findConversationIdByUserId(req, res, next),
);

router.get('/search', (req, res, next) =>
  controller().searchConversations(req, res, next),
);

// Declared before '/:id' so the literal wins the match.
router.get('/muted', (req, res, next) =>
  controller().getMutedConversations(req, res, next),
);

router
  .route('/:id/members')
  .all(validateConversation)
  .patch((req, res, next) =>
    controller().manageConversationMembers(req, res, next),
  );

// The service and controller for these existed, but nothing routed to them —
// so a mute was honoured everywhere and could never actually be set.
router
  .route('/:id/mute')
  .all(validateConversation)
  .post((req, res, next) => controller().muteConversation(req, res, next))
  .delete((req, res, next) => controller().unmuteConversation(req, res, next));

router
  .route('/:id')
  .all(validateConversation)
  // Was an inline handler duplicating ConversationController.getConversationById,
  // which had no route and so was dead. Same populate, same self-filter, same
  // shape — the controller just also guards the conversation being absent.
  .get((req, res, next) => controller().getConversationById(req, res, next))
  .patch((req, res, next) => controller().updateConversation(req, res, next))
  .delete((req, res, next) => controller().deleteConversation(req, res, next));

export default router;
