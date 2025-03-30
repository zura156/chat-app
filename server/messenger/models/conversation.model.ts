import { model, Schema, Types } from 'mongoose';

export interface IConversation extends Document {
  participants: Types.ObjectId;
  last_message: Types.ObjectId;
  is_group: boolean;
  group_name: string;
  group_picture: string;
}

const ConversationSchema = new Schema<IConversation>(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    last_message: { type: Schema.Types.ObjectId, ref: 'Message' }, // For quick access
    is_group: { type: Boolean, default: false },
    group_name: { type: String }, // Optional for group chats
    group_picture: { type: String }, // Optional for group chats
  },
  { timestamps: true }
);

export const Conversation = model<IConversation>(
  'Conversation',
  ConversationSchema
);
