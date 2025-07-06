import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { ConversationService } from '../services/conversation.service';
import { Conversation } from '../models/conversation.model';

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
      const userId = req.user!.userId;
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
      const userId = req.user!.userId;
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

  public getConversationById = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.userId;
      const conversationId = req.params.id;
      const conversation = await this.conversationService.getConversationById(
        conversationId,
        userId
      );
      res.status(200).json(conversation);
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
      const { participants, is_group, group_name, group_picture } =
        req.body.conversation;
      const conversation = await this.conversationService.createConversation(
        participants,
        is_group,
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
      const { id } = req.params; // Using 'id' to match your router
      const { group_name, group_picture } = req.body.conversation;
      const conversation = await this.conversationService.updateConversation(
        id,
        { group_name, group_picture }
      );
      res.status(200).json(conversation);
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
      const { id } = req.params; // Using 'id' to match your router
      const userId = req.user!.userId;
      await this.conversationService.deleteConversation(id, userId);
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
      const userId = req.user!.userId;
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
      const userId = req.user!.userId;
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
    const conversationId = req.params.id;
    const userId = req.user?.userId;
    const { add, remove } = req.body;

    if (!userId) {
      res.status(401).json({ message: 'User is not authorized!' });
      return;
    }

    if (!conversationId || (!add.length && !remove.length)) {
      res.status(400).json({ message: 'Bad requst' });
      return;
    }

    try {
      const conversation =
        await this.conversationService.manageConversationMembers(
          userId,
          { add, remove },
          conversationId
        );

      res.status(200).json(conversation);
    } catch (error) {
      next(error);
    }
  };
}
