import { Types } from 'mongoose';
import { MessageTypeEnum } from '../interfaces/message.interface';
import { Conversation } from '../models/conversation.model';
import { IMessage, Message } from '../models/message.model';

export const saveMessage = async (data: {
  sender: string;
  conversation: string;
  content: string;
  type: MessageTypeEnum;
}): Promise<IMessage | null> => {
  try {
    const conversationObjectId = new Types.ObjectId(data.conversation);

    // Save message first
    const message = await Message.create({
      sender: data.sender,
      conversation: conversationObjectId,
      content: data.content,
      type: data.type,
    });

    // Update last_message in conversation with the new message's ID
    await Conversation.findByIdAndUpdate(conversationObjectId, {
      last_message: message._id, // Use the message ID instead of content
    });

    return await Message.findById(message._id)
    .populate('sender', 'username profile_picture');

  } catch (e) {
    console.error('Error while trying to save a message', e);
    return null;
  }
};
