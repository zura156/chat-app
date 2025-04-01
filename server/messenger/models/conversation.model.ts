import { model, Schema, Types, Document } from 'mongoose';

export interface IConversation extends Document {
  participants: Types.ObjectId[]; // ✅ Fixed: Array for multiple participants
  last_message?: Types.ObjectId; // ✅ Fixed: Optional last message
  is_group: boolean;
  group_name?: string; // ✅ Fixed: Optional for group chats only
  group_picture?: string; // ✅ Fixed: Optional for group chats only
  createdAt?: Date;
  updatedAt?: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    participants: [
      { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ],
    last_message: { type: Schema.Types.ObjectId, ref: 'Message' }, // ✅ Optional
    is_group: { type: Boolean, default: false },
    group_name: { type: String, required: false }, // ✅ Optional
    group_picture: { type: String, required: false }, // ✅ Optional
  },
  { timestamps: true }
);

export const Conversation = model<IConversation>(
  'Conversation',
  ConversationSchema
);
