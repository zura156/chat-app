import { Schema, model, Document, Types } from 'mongoose';
import {
  MessageStatusEnum,
  MessageTypeEnum,
} from '../interfaces/message.interface';
import { ScanStatus } from '../../config/upload.config';

export interface IAttachment {
  fileKey: string; // staging key until clean, then permanent key
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: ScanStatus;
  permanentUrl?: string; // populated after clean
}

export interface IMessage extends Document {
  sender: Types.ObjectId;
  conversation: Types.ObjectId;
  content?: string;
  attachments?: IAttachment[];
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
  attachments: [
    {
      fileKey: String,
      originalName: String,
      mimeType: String,
      sizeBytes: Number,
      scanStatus: {
        type: String,
        enum: ['scanning', 'clean', 'infected', 'error'],
      },
      permanentUrl: String,
    },
  ],
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
  if (!this.content?.trim() && !this.attachments?.length) {
    throw new Error(
      'Message must have either text content or a file attachment.',
    );
  }
});

export const Message = model<IMessage>('Message', MessageSchema);
