import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { ConversationService } from '../services/conversation.service';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';
import { clampLimit, clampOffset } from '../../utils/pagination';

export class ConversationController {
  private conversationService: ConversationService;

  constructor(conversationService: ConversationService) {
    this.conversationService = conversationService;
  }

  public getConversations = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!._id.toString();
      const limit = clampLimit(req.query.limit);
      const offset = clampOffset(req.query.offset);
      const result = await this.conversationService.getConversations(
        userId,
        limit,
        offset,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  public searchConversations = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!._id.toString();
      const query = req.query['q'] as string;
      const conversations = await this.conversationService.searchConversations(
        userId,
        query,
      );
      res.status(200).json({ conversations, totalCount: conversations.length });
    } catch (error) {
      next(error);
    }
  };

  public findConversationIdByUserId = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.user!._id.toString();
      const { participantId } = req.params;
      if (typeof participantId !== 'string') {
        next(createCustomError('Participant ID is missing or invalid!', 400));
        return;
      }

      const conversation =
        await this.conversationService.findConversationIdByUserId(
          userId,
          participantId,
        );
      res.status(200).json({ conversationId: conversation._id });
    } catch (error) {
      next(error);
    }
  };

  public getConversationById = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!._id.toString();
      const conversation = req.conversation;

      if (!conversation) {
        res
          .status(403)
          .json(
            'Conversation either does not exist, or you do not have the access to this conversation.',
          );
        return;
      }

      const filteredConversation =
        await this.conversationService.getConversationById(
          conversation,
          userId,
        );
      res.status(200).json(filteredConversation);
    } catch (error) {
      next(error);
    }
  };

  public createConversation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!._id.toString();

      // Destructuring this unguarded threw a TypeError — and so a 500 — for any
      // body without a `conversation` key, which is a client mistake and should
      // read as one.
      const payload = req.body?.conversation;
      if (!payload || typeof payload !== 'object') {
        next(createCustomError('A conversation payload is required', 400));
        return;
      }

      const { participants, is_group, group_name, group_picture } = payload;

      if (!Array.isArray(participants)) {
        next(createCustomError('participants must be an array', 400));
        return;
      }

      const conversation = await this.conversationService.createConversation(
        participants,
        !!is_group,
        userId,
        group_name,
        group_picture,
      );
      res.status(201).json(conversation);
    } catch (error) {
      next(error);
    }
  };

  public updateConversation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { conversation } = req; // Using 'id' to match router

      if (!conversation) {
        next(createCustomError('Conversation validation failed!', 500));
        return;
      }

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
        );
      res.status(200).json(updatedConversation);
    } catch (error) {
      next(error);
    }
  };

  public deleteConversation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { conversation } = req;
      const userId = req.user!._id.toString();
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

  public getMutedConversations = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!._id.toString();
      const conversationIds =
        await this.conversationService.getMutedConversationIds(userId);
      res.status(200).json({ conversationIds });
    } catch (error) {
      next(error);
    }
  };

  public muteConversation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      // `id` to match the rest of this router, whose validateConversation
      // middleware reads that param and is what proves membership here.
      const conversationId = req.params['id'];
      if (typeof conversationId !== 'string') {
        next(createCustomError('Conversation ID is missing or invalid!', 400));
        return;
      }
      const userId = req.user!._id.toString();
      await this.conversationService.muteConversation(conversationId, userId);
      res.status(200).json({ message: 'Conversation muted successfully' });
    } catch (error) {
      next(error);
    }
  };

  public unmuteConversation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const conversationId = req.params['id'];
      if (typeof conversationId !== 'string') {
        next(createCustomError('Conversation ID is missing or invalid!', 400));
        return;
      }
      const userId = req.user!._id.toString();
      await this.conversationService.unmuteConversation(conversationId, userId);
      res.status(200).json({ message: 'Conversation unmuted successfully' });
    } catch (error) {
      next(error);
    }
  };

  public manageConversationMembers = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    const { conversation } = req;
    const userId = req.user?._id.toString();

    if (!userId) {
      res.status(401).json({ message: 'User is not authorized!' });
      return;
    }

    /*
     * Both keys are optional on the wire. Reading `.length` off whatever the
     * body happened to contain threw a TypeError for any request that sent only
     * one of them — a 500 for what is a perfectly ordinary client mistake, and
     * one that never surfaced because this app's own client always sends both.
     */
    const add = Array.isArray(req.body?.add) ? req.body.add : [];
    const remove = Array.isArray(req.body?.remove) ? req.body.remove : [];

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
          { add, remove },
        );

      res.status(200).json(updatedConversation);
    } catch (error) {
      next(error);
    }
  };
}
