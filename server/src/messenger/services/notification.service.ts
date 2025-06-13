import { Notification } from '../models/notifications.model';
import { MutedConversation } from '../models/muted-conversation.model';
import { Conversation } from '../models/conversation.model';
import { Types } from 'mongoose';

export const createNotification = async (
  senderId: string,
  conversationId: string,
  messageId: string
): Promise<void> => {
  const conversationObjectId = new Types.ObjectId(conversationId);

  // Get all participants in the conversation
  const conversation = await Conversation.findById(
    conversationObjectId
  ).populate('participants');

  if (!conversation) return;

  for (const participant of conversation.participants) {
    if (participant._id.toString() === senderId) continue;

    const isMuted = await MutedConversation.findOne({
      user: participant._id,
      conversation: conversationObjectId,
    });

    if (!isMuted) {
      await Notification.create({
        user: participant._id,
        conversation: conversationObjectId,
        message: messageId,
        type: 'message',
        seen: false,
      });
    }
  }
};
