import { MessageType } from '../interfaces/message.interface';
import { Conversation } from '../models/conversation.model';
import { Message } from '../models/message.model';

export const saveMessage = async (data: {
  from: string;
  to: string | null; // `null` for group chat
  message: string;
  type: MessageType;
  conversationId: string;
  isGroup: boolean;
}) => {
  try {
    // Find or create conversation
    const conversation = await Conversation.findByIdAndUpdate(
      data.conversationId,
      { lastMessage: data.message },
      { new: true }
    );

    if (!conversation) {
      throw new Error('Failed to find conversation');
    }

    // Save the message
    const newMessage = await Message.create({
      sender: data.from,
      conversation: data.conversationId,
      content: data.message,
      type: data.type,
      status: 'sent',
      readBy: data.isGroup ? [data.from] : [], // Group chat: Only sender initially
    });

    return newMessage;
  } catch (error) {
    console.error('Error in saveMessage:', error);
    throw new Error('Could not save message');
  }
};
