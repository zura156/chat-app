import { Request, Response, NextFunction } from 'express';
import { ChatDto } from '../dto/chat.dto';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';
import { Conversation } from '../models/conversation.model';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { Types } from 'mongoose';
import { MutedConversation } from '../models/muted-conversation.model';
import { User } from '../../user/models/user.model';

export const getConversations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    if (!userId) {
      return next(createCustomError('User ID is required', 400));
    }

    const [conversations, totalCount] = await Promise.all([
      Conversation.find({ participants: userId })
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .populate('participants', 'username profile_picture')
        .populate({
          path: 'last_message',
          select: 'content sender createdAt',
          populate: { path: 'sender', select: 'username profilePicture' },
        }),
      Conversation.countDocuments({ participants: userId }),
    ]);

    res.status(200).json({ conversations, totalCount });
  } catch (err) {
    console.error('Error fetching user conversations:', err);
    next(createCustomError('Failed to fetch conversations', 500));
  }
};

export const searchConversations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const query = req.query['q'];
    const userId = new Types.ObjectId(req.user?.userId);

    if (!userId) {
      return next(createCustomError('User ID is required', 400));
    }

    const [conversations, totalCount] = await Promise.all([
      Conversation.find({
        participants: userId,
        $or: [
          {
            group_name: { $regex: query, $options: 'i' },
          },
          {
            participants: {
              $in: await User.find({
                $or: [
                  { username: { $regex: query, $options: 'i' } },
                  { first_name: { $regex: query, $options: 'i' } },
                  { last_name: { $regex: query, $options: 'i' } },
                ],
                _id: { $ne: userId },
              }).distinct('_id'),
            },
          },
        ],
      })
        .populate('participants', 'username profile_picture')
        .populate({
          path: 'last_message',
          select: 'content sender createdAt',
          populate: { path: 'sender', select: 'username profile_picture' },
        })
        .sort({ updatedAt: -1 }),
      Conversation.countDocuments({ participants: userId }),
    ]);

    res.status(200).json({ conversations, totalCount });
  } catch (err) {
    console.error('Error fetching user conversations:', err);
    next(createCustomError('Failed to fetch conversations', 500));
  }
};

export const getConversationById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.userId;
    const conversationId = req.params.id;

    if (!userId) {
      return next(createCustomError('User ID is required', 400));
    }
    if (!conversationId) {
      next(createCustomError('Conversation ID is required', 400));
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    }).populate(
      'participants',
      'first_name last_name username profile_picture status last_seen'
    );

    if (!conversation) {
      return next(createCustomError('conversation not found!', 404));
    }

    const otherParticipants = conversation.participants.filter(
      (p) => p._id.toString() !== userId.toString()
    );

    // res.status(200).json(conversation);
    res.status(200).json({
      ...conversation.toObject(),
      participants: otherParticipants,
    });
  } catch (e) {
    console.error('Error while fetching conversation by id!', e);
    next(createCustomError('Error while fetching conversation by id', 500));
  }
};

export const createConversation = async (
  req: ChatDto,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return next(createCustomError('User ID is required', 400));
    }

    const { participants, is_group, group_name, group_picture } =
      req.body.conversation;

    if (!Array.isArray(participants) || participants.length < 2) {
      return next(
        createCustomError('At least two participants are required', 400)
      );
    }

    // First check if the conversation exists
    let conversation = await Conversation.findOne({
      participants: { $all: participants },
      $expr: { $eq: [{ $size: '$participants' }, participants.length] },
    });

    // If it exists, throw error
    if (conversation) {
      return next(createCustomError('Conversation already exists', 409));
    }

    conversation = await Conversation.create({
      participants,
      is_group,
    });

    const populatedConversation = await Conversation.findById(conversation._id)
      .populate('participants', 'first_name last_name username profile_picture')
      .populate({
        path: 'last_message',
        select: 'content sender createdAt',
        populate: {
          path: 'sender',
          select: 'first_name last_name username profilePicture',
        },
      })
      .lean();

    if (!populatedConversation) {
      res.status(200).json(conversation);
      return;
    }

    const otherParticipants = populatedConversation.participants.filter(
      (p) => p._id.toString() !== userId.toString()
    );

    res.status(200).json({
      ...conversation.toObject(),
      participants: otherParticipants,
    });
  } catch (e: any) {
    console.error('Error creating conversation:', e);
    next(createCustomError(`Failed to create conversation: ${e.message}`, 500));
  }
};

export const updateConversation = async (
  req: ChatDto,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { group_name, group_picture, last_message } = req.body.conversation;

    // Validate input
    if (!conversationId) {
      return next(createCustomError('Conversation ID is required', 400));
    }

    // Find and update the conversation
    const updatedConversation = await Conversation.findByIdAndUpdate(
      conversationId,
      { group_name, group_picture, last_message },
      { new: true } // Return the updated document
    );

    if (!updatedConversation) {
      return next(createCustomError('Conversation not found', 404));
    }

    res.status(200).json(updatedConversation);
  } catch (error) {
    console.error('Error updating conversation:', error);
    next(createCustomError('Failed to update conversation', 500));
  }
};

export const deleteConversation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new Types.ObjectId(req.user?.userId);
    const conversationId = new Types.ObjectId(req.params.conversationId);

    if (!conversationId || !userId) {
      return next(
        createCustomError('Conversation ID and User ID are required', 400)
      );
    }

    // Find the conversation
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return next(createCustomError('Conversation not found', 404));
    }

    // Check if user is a participant
    if (!conversation.participants.includes(userId)) {
      return next(
        createCustomError(
          'You are not authorized to delete this conversation',
          403
        )
      );
    }

    // Delete the conversation
    await Conversation.findByIdAndDelete(conversationId);

    res.status(200).json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    next(createCustomError('Failed to delete conversation', 500));
  }
};

export const muteConversation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new Types.ObjectId(req.user?.userId);
    const conversationId = new Types.ObjectId(req.params.conversationId);

    const isMuted = await MutedConversation.findOne({
      user: userId,
      conversation: conversationId,
    });
    if (isMuted) {
      res.status(400).json({ message: 'Conversation already muted' });
      return;
    }

    await MutedConversation.create({
      user: userId,
      conversation: conversationId,
    });

    res.status(200).json({ message: 'Conversation muted successfully' });
  } catch (error) {
    next(error);
  }
};
export const unmuteConversation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new Types.ObjectId(req.user?.userId);
    const conversationId = new Types.ObjectId(req.params.conversationId);

    await MutedConversation.findOneAndDelete({
      user: userId,
      conversation: conversationId,
    });

    res.status(200).json({ message: 'Conversation unmuted successfully' });
  } catch (error) {
    next(error);
  }
};
