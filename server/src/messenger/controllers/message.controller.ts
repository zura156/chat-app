import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../auth/middlewares/auth.middleware'; // Your existing type
import { MessageService } from '../services/message.service';
import { createCustomError } from '../../error-handling/models/custom-api-error.model'; // Your error handler
import { Types } from 'mongoose';
import { Message } from '../models/message.model';

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
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      const conversationId = req.conversation?.id;
      if (!conversationId) {
        res
          .status(403)
          .json(
            'Conversation either does not exist, or you do not have the access to this conversation.'
          );
        return;
      }

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

  public getMediaMessages = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const conversationId = req.conversation?.id;

    if (!conversationId) {
      res
        .status(403)
        .json(
          'Conversation either does not exist, or you do not have the access to this conversation.'
        );
      return;
    }

    try {
      const result = this.messageService.getMediaMessages(
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
  public getFileMessages = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const conversationId = req.conversation?.id;

    if (!conversationId) {
      res
        .status(403)
        .json(
          'Conversation either does not exist, or you do not have the access to this conversation.'
        );
      return;
    }

    try {
      const result = this.messageService.getFileMessages(
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

  getMediaFileStats = async (req: AuthRequest, res: Response) => {
    try {
      const { userId, conversationId } = req.query;

      const matchStage: any = {
        file: { $exists: true },
      };

      if (userId) {
        matchStage.sender = new Types.ObjectId(userId as string);
      }

      if (conversationId) {
        matchStage.conversation = new Types.ObjectId(conversationId as string);
      }

      const stats = await Message.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              $cond: {
                if: {
                  $regexMatch: {
                    input: '$file.mime_type',
                    regex: /^(image|video)\//,
                  },
                },
                then: 'media',
                else: 'files',
              },
            },
            count: { $sum: 1 },
            totalSize: { $sum: '$file.size_in_bytes' },
            averageSize: { $avg: '$file.size_in_bytes' },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      // Format the response
      const result = {
        media: { count: 0, totalSize: 0, averageSize: 0 },
        files: { count: 0, totalSize: 0, averageSize: 0 },
      };

      stats.forEach((stat) => {
        if (stat._id === 'media') {
          result.media = {
            count: stat.count,
            totalSize: stat.totalSize,
            averageSize: Math.round(stat.averageSize),
          };
        } else {
          result.files = {
            count: stat.count,
            totalSize: stat.totalSize,
            averageSize: Math.round(stat.averageSize),
          };
        }
      });

      res.json({ stats: result });
    } catch (error) {
      console.error('Error fetching media/file statistics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get media/file statistics',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
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
      const { conversationId, duration } = req.body; // Assuming conversationId is sent in the form data
      const senderId = req.user?.id;

      if (!req.file) {
        return next(createCustomError('No file was uploaded.', 400));
      }
      if (!senderId || !conversationId) {
        return next(
          createCustomError('Sender ID and Conversation ID are required.', 400)
        );
      }

      if (req.file.mimetype.startsWith('audio/') && !duration) {
        console.warn(
          'Warning: Audio file received without a duration from the client.'
        );
      }

      // Delegate the core logic to the service
      const savedMessage = await this.messageService.createFileMessage(
        req.file,
        senderId,
        conversationId,
        duration // Pass the duration to the service
      );

      res.status(201).json(savedMessage);
    } catch (error) {
      console.error('Upload controller error:', error);
      next(createCustomError('Failed to process file upload.', 500));
    }
  };
}
