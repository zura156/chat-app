import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../auth/middlewares/auth.middleware'; // Your existing type
import { MessageService } from '../services/message.service';
import { createCustomError } from '../../error-handling/models/custom-api-error.model'; // Your error handler

export class MessageController {
  private messageService: MessageService;

  // The controller is initialized with an instance of the service
  constructor(messageService: MessageService) {
    this.messageService = messageService;
  }

  /**
   * Handles the HTTP request to get messages for a conversation.
   * This is the refactored version of your `getMessagesByConversationId`.
   */
  public getMessagesByConversationId = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { conversationId } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      // The controller's job is to orchestrate. It calls the service to do the work.
      const result = await this.messageService.getMessagesForConversation(
        conversationId,
        limit,
        offset
      );

      res.status(200).json(result);
    } catch (error) {
      console.error('Error fetching messages:', error);
      next(createCustomError('Failed to fetch messages', 500));
    }
  };

  /**
   * Handles the HTTP request to upload a file message.
   * This is the new functionality.
   */
  public uploadFileMessage = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { conversationId } = req.body; // Assuming conversationId is sent in the form data
      const senderId = req.user?.userId;

      if (!req.file) {
        return next(createCustomError('No file was uploaded.', 400));
      }
      if (!senderId || !conversationId) {
        return next(
          createCustomError('Sender ID and Conversation ID are required.', 400)
        );
      }

      // Delegate the core logic to the service
      const savedMessage = await this.messageService.createFileMessage(
        req.file,
        senderId,
        conversationId
      );

      res.status(201).json(savedMessage);
    } catch (error) {
      console.error('Upload controller error:', error);
      next(createCustomError('Failed to process file upload.', 500));
    }
  };
}
