import { MessageService } from './services/message.service';
import { MessageController } from './controllers/message.controller';
import { ConversationService } from './services/conversation.service';
import { ConversationController } from './controllers/conversation.controller';
import { getBroadcastFunction } from '../websocket/websocket.setup';

/*
 * One instance of each, built on first use.
 *
 * The routers used to construct a fresh service *and* controller per request,
 * behind `if (!req.messageService)` guards that could never be true — `req` is
 * new every time. Nothing here holds request state, so a singleton is both
 * correct and the obvious shape.
 *
 * Construction is lazy because the broadcast function does not exist until the
 * WebSocket server has been set up, and these modules are imported before that
 * happens.
 */

let messageService: MessageService | undefined;
let messageController: MessageController | undefined;
let conversationService: ConversationService | undefined;
let conversationController: ConversationController | undefined;

export const getMessageService = (): MessageService => {
  messageService ??= new MessageService(getBroadcastFunction());
  return messageService;
};

export const getMessageController = (): MessageController => {
  messageController ??= new MessageController(getMessageService());
  return messageController;
};

export const getConversationService = (): ConversationService => {
  conversationService ??= new ConversationService(
    getBroadcastFunction(),
    getMessageService(),
  );
  return conversationService;
};

export const getConversationController = (): ConversationController => {
  conversationController ??= new ConversationController(
    getConversationService(),
  );
  return conversationController;
};
