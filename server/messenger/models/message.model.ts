import { Schema, model, Document, Types } from 'mongoose';
import {
  MessageStatusEnum,
  MessageTypeEnum,
} from '../interfaces/message.interface';

export interface IFile {
  url: string;
  name: string;
  mime_type: string;
  size_in_bytes: number;
}

export interface IMessage extends Document {
  sender: Types.ObjectId;
  conversation: Types.ObjectId;
  content?: string;
  file?: IFile;
  type: MessageTypeEnum;
  status: MessageStatusEnum;
  timestamp: Date;
  edited_at?: Date;
}
const MessageSchema = new Schema<IMessage>({
  sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  conversation: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  },
  content: { type: String, required: false },

  file: {
    url: { type: String },
    name: { type: String },
    mime_type: { type: String },
    size_in_bytes: { type: Number },
  },

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
  timestamp: { type: Date, default: Date.now },
  edited_at: { type: Date, required: false },
});

MessageSchema.pre('validate', function (next) {
  if ((!this.content || this.content.trim().length === 0) && !this.file) {
    next(
      new Error('Message must have either text content or a file attachment.')
    );
  } else {
    next();
  }
});

export const Message = model<IMessage>('Message', MessageSchema);
