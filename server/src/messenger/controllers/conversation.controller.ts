import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { ConversationService } from '../services/conversation.service';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';

export class ConversationController {
  private conversationService: ConversationService;

  constructor(conversationService: ConversationService) {
    this.conversationService = conversationService;
  }

  public getConversations = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      const result = await this.conversationService.getConversations(
        userId,
        limit,
        offset
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  public searchConversations = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const query = req.query['q'] as string;
      const conversations = await this.conversationService.searchConversations(
        userId,
        query
      );
      res.status(200).json({ conversations, totalCount: conversations.length });
    } catch (error) {
      next(error);
    }
  };

  public findConversationIdByUserId = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user!.id;
      const participantId = req.params.participantId;
      const conversation =
        await this.conversationService.findConversationIdByUserId(
          userId,
          participantId
        );
      res.status(200).json({ conversationId: conversation._id });
    } catch (error) {
      next(error);
    }
  };

  public getConversationById = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const conversation = req.conversation;

      if (!conversation) {
        res
          .status(403)
          .json(
            'Conversation either does not exist, or you do not have the access to this conversation.'
          );
        return;
      }

      const filteredConversation =
        await this.conversationService.getConversationById(
          conversation,
          userId
        );
      res.status(200).json(filteredConversation);
    } catch (error) {
      next(error);
    }
  };

  public createConversation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id: userId } = req.user!;
      const { participants, is_group, group_name, group_picture } =
        req.body.conversation;
      const conversation = await this.conversationService.createConversation(
        participants,
        is_group,
        userId,
        group_name,
        group_picture
      );
      res.status(201).json(conversation);
    } catch (error) {
      next(error);
    }
  };

  public updateConversation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { conversation } = req; // Using 'id' to match your router

      if (!conversation) {
        next(createCustomError('Conversation validation failed!', 500));
        return;
      }

      const group_picture = req.file;
      const { group_name } = req.body;
      const user = req.user;

      if (!user) {
        next(createCustomError('Auth validation issue detected', 500));
        return;
      }

      const updatedConversation =
        await this.conversationService.updateConversation(
          conversation,
          user,
          group_name,
          group_picture
        );
      res.status(200).json(updatedConversation);
    } catch (error) {
      next(error);
    }
  };

  public deleteConversation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { conversation } = req;
      const userId = req.user!.id;
      if (!conversation || !userId) {
        next(createCustomError('Conversation or user ID is missing!', 400));
        return;
      }
      await this.conversationService.deleteConversation(conversation, userId);
      res.status(200).json({ message: 'Conversation deleted successfully' });
    } catch (error) {
      next(error);
    }
  };

  public muteConversation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user!.id;
      await this.conversationService.muteConversation(conversationId, userId);
      res.status(200).json({ message: 'Conversation muted successfully' });
    } catch (error) {
      next(error);
    }
  };

  public unmuteConversation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user!.id;
      await this.conversationService.unmuteConversation(conversationId, userId);
      res.status(200).json({ message: 'Conversation unmuted successfully' });
    } catch (error) {
      next(error);
    }
  };

  public manageConversationMembers = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    const { conversation } = req;
    const userId = req.user?.id;
    const { add, remove } = req.body;

    if (!userId) {
      res.status(401).json({ message: 'User is not authorized!' });
      return;
    }

    if (!conversation || (!add.length && !remove.length)) {
      res
        .status(400)
        .json({ message: 'Conversation or update data is invalid.' });
      return;
    }

    try {
      const updatedConversation =
        await this.conversationService.manageConversationMembers(
          conversation,
          userId,
          { add, remove }
        );

      res.status(200).json(updatedConversation);
    } catch (error) {
      next(error);
    }
  };
}
