import { model, Schema, Types, Document, now } from 'mongoose';

export interface IConversation extends Document {
  participants: Types.ObjectId[];
  last_message?: Types.ObjectId;
  read_receipts: {
    user_id: Types.ObjectId;
    last_message_read_id?: string;
    read_at: Date;
  }[];
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
    read_receipts: [
      {
        _id: false, // Disable automatic _id generation for read receipts
        user_id: { type: Schema.Types.ObjectId, ref: 'User' },
        last_message_read_id: { type: String },
        read_at: { type: Date, default: now() },
      },
    ],
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
