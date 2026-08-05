import { Router } from 'express';
import { MessageController } from '../controllers/message.controller';
import { validateConversation } from '../middlewares/validate-conversation.middleware';
import { getMessageController } from '../messenger.container';

const router = Router();

/*
 * The controller and service are resolved once, lazily, rather than
 * reconstructed on every request. They hold no per-request state — only the
 * broadcast function — so a new pair per request was pure allocation, and the
 * `if (!req.messageService)` guards that wrapped it could never be true: each
 * request starts with a fresh `req`.
 */
const controller = (): MessageController => getMessageController();

// --- Routes ---

router.post('/:id/send', validateConversation, (req, res, next) =>
  controller().sendMessage(req, res, next),
);

router.get('/:id/messages', validateConversation, (req, res, next) =>
  controller().getMessagesByConversationId(req, res, next),
);

// `:id` is the conversation, which validateConversation proves membership of;
// ownership of `:messageId` is checked in the service.
router
  .route('/:id/messages/:messageId')
  .all(validateConversation)
  .patch((req, res, next) => controller().editMessage(req, res, next))
  .delete((req, res, next) => controller().deleteMessage(req, res, next));

router.get('/:id/media', validateConversation, (req, res, next) =>
  controller().getMediaMessages(req, res, next),
);

router.get('/:id/files', validateConversation, (req, res, next) =>
  controller().getFileMessages(req, res, next),
);

export default router;
