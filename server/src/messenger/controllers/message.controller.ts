import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../auth/middlewares/auth.middleware'; // Your existing type
import { MessageService } from '../services/message.service';
import {
  createCustomError,
  CustomAPIError,
} from '../../error-handling/models/custom-api-error.model'; // Your error handler
import { clampLimit, clampOffset } from '../../utils/pagination';

export class MessageController {
  private messageService: MessageService;

  // The controller is initialized with an instance of the service
  constructor(messageService: MessageService) {
    this.messageService = messageService;
  }

  public editMessage = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const senderId = req.user?._id?.toString();
      const conversationId = req.conversation?._id.toString();
      const messageId = String(req.params.messageId ?? '');
      const { content } = req.body ?? {};

      if (!senderId || !conversationId) {
        next(createCustomError('Conversation not found or access denied.', 403));
        return;
      }

      const message = await this.messageService.editMessage(
        senderId,
        conversationId,
        messageId,
        content,
      );

      res.status(200).json(message);
    } catch (error) {
      next(error);
    }
  };

  public deleteMessage = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const senderId = req.user?._id?.toString();
      const conversationId = req.conversation?._id.toString();
      const messageId = String(req.params.messageId ?? '');

      if (!senderId || !conversationId) {
        next(createCustomError('Conversation not found or access denied.', 403));
        return;
      }

      const result = await this.messageService.deleteMessage(
        senderId,
        conversationId,
        messageId,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * REST API endpoint for sending a message
   */
  public sendMessage = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const senderId = req.user?._id?.toString();
      const conversationId = req.conversation?._id.toString();
      const { content, attachments, tempId } = req.body;

      if (!conversationId) {
        next(
          createCustomError('Conversation not found or access denied.', 403),
        );
        return;
      }

      if (!content?.trim() && !attachments?.length) {
        next(
          createCustomError('Message must have content or attachments.', 400),
        );
        return;
      }

      const message = await this.messageService.createMessageWithAttachments(
        senderId!,
        conversationId,
        content,
        attachments ?? [],
        tempId,
      );

      res.status(201).json(message);
    } catch (error: any) {
      // An error that already carries a status keeps it. Wrapping everything as
      // 500 turned a refusal the caller could act on — blocked, or content too
      // long — into "something went wrong on our end".
      next(
        error instanceof CustomAPIError
          ? error
          : createCustomError(error.message || 'Failed to send message', 500),
      );
    }
  };

  /**
   * Handles the HTTP request to get messages for a conversation.
   * This is the refactored version of your `getMessagesByConversationId`.
   */
  public getMessagesByConversationId = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const limit = clampLimit(req.query.limit);
      const offset = clampOffset(req.query.offset);

      const conversationId = req.conversation?._id.toString();
      if (!conversationId) {
        next(
          createCustomError(
            'Conversation either does not exist, or you do not have access to it.',
            403,
          ),
        );
        return;
      }

      // The controller's job is to orchestrate. It calls the service to do the work.
      const result = await this.messageService.getMessagesForConversation(
        conversationId,
        limit,
        offset,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  public getMediaMessages = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);

    const conversationId = req.conversation?._id.toString();

    if (!conversationId) {
      next(
        createCustomError(
          'Conversation either does not exist, or you do not have access to it.',
          403,
        ),
      );
      return;
    }

    try {
      const result = await this.messageService.getMediaMessages(
        conversationId,
        limit,
        offset,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
  public getFileMessages = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);

    const conversationId = req.conversation?._id.toString();

    if (!conversationId) {
      next(
        createCustomError(
          'Conversation either does not exist, or you do not have access to it.',
          403,
        ),
      );
      return;
    }

    try {
      const result = await this.messageService.getFileMessages(
        conversationId,
        limit,
        offset,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

}

/*
 * `getMediaFileStats` used to live here. It was removed rather than fixed:
 * nothing routed to it, it aggregated over a `file` field that stopped existing
 * when attachments became an array (so it could only ever have returned zeroes),
 * and it read `userId` and `conversationId` straight from the query with no
 * authorisation check — had anyone mounted it, it would have reported any
 * user's storage totals to any caller. The storage screen is served by
 * `GET /user/storage`, which scopes to the authenticated user.
 */
