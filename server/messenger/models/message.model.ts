import { Schema, model, Document, Types, now } from 'mongoose';
import {
  MessageStatusEnum,
  MessageTypeEnum,
} from '../interfaces/message.interface';

export interface IMessage extends Document {
  sender: Types.ObjectId;
  conversation: Types.ObjectId;
  content: string;
  type: MessageTypeEnum;
  status: MessageStatusEnum;
  readReceipts: { userId: Types.ObjectId; readAt: Date }[];
  createdAt?: Date;
  updatedAt?: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversation: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    content: { type: String, required: true },
    type: {
      type: String,
      enum: Object.values(MessageTypeEnum),
      default: MessageTypeEnum.TEXT,
    },
    status: {
      type: String,
      enum: Object.values(MessageStatusEnum),
      default: MessageStatusEnum.SENT,
    },
    readReceipts: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: now() },
      },
    ],
  },
  { timestamps: true }
);

export const Message = model<IMessage>('Message', MessageSchema);
