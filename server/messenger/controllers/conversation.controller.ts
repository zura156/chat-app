import { Response, NextFunction } from 'express';
import { CreateChatDto } from '../dto/create-chat.dto';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';
import { Conversation } from '../models/conversation.model';

export const createChat = async (
  req: CreateChatDto,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { participants, is_group, group_name, group_picture } =
      req.body.conversation;

    if (!Array.isArray(participants) || participants.length < 2) {
      return next(
        createCustomError('Atl least two participants are required', 400)
      );
    }

    let conversation;

    if (is_group) {
      conversation = await Conversation.create({
        participants,
        is_group: true,
        group_name,
        group_picture,
      });
    } else {
      conversation = await Conversation.findOneAndUpdate(
        { participants: { $all: participants, $size: 2 } },
        {},
        { upsert: true, new: true }
      );
    }

    res.status(201).json(conversation);
  } catch (e) {
    next(createCustomError('Failed to create conversation', 500));
  }
};
