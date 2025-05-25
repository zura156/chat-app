import { Schema, model, Document, Types } from 'mongoose';
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
  },
  { timestamps: true }
);

export const Message = model<IMessage>('Message', MessageSchema);
