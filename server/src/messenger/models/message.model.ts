import { Schema, model, Document, Types } from 'mongoose';
import {
  MessageStatusEnum,
  MessageTypeEnum,
} from '../interfaces/message.interface';

export interface IFile {
  url: string;
  placeholder_url?: string;
  thumbnail_url?: string;
  duration?: number;
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
  content: { type: String },
  file: {
    url: { type: String },
    placeholder_url: { type: String },
    thumbnail_url: { type: String },
    duration: { type: Number },
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
  edited_at: { type: Date },
});

MessageSchema.pre('validate', function validateContentOrFile() {
  if (!this.content?.trim() && !this.file) {
    throw new Error(
      'Message must have either text content or a file attachment.',
    );
  }
});

export const Message = model<IMessage>('Message', MessageSchema);
