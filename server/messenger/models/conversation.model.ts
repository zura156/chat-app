import { model, Schema, Types, Document } from 'mongoose';

export interface IConversation extends Document {
  participants: Types.ObjectId[];
  last_message?: Types.ObjectId;
  is_group: boolean;
  group_name?: string;
  group_picture?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    participants: [
      { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ],
    last_message: { type: Schema.Types.ObjectId, ref: 'Message' },
    is_group: { type: Boolean, default: false },
    group_name: { type: String, required: false },
    group_picture: { type: String, required: false },
  },
  { timestamps: true }
);

export const Conversation = model<IConversation>(
  'Conversation',
  ConversationSchema
);
