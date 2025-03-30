import { Conversation } from '../models/conversation.model';
import { Message } from '../models/message.model';

export const saveMessage = async (data: {
  from: string;
  to: string;
  message: string;
}) => {
  const conversation = await Conversation.findOneAndUpdate(
    { participants: { $all: [data.from, data.to] } },
    { lastMessage: data.message },
    { upsert: true, new: true }
  );

  return await Message.create({
    sender: data.from,
    conversation: conversation._id,
    content: data.message,
  });
};
