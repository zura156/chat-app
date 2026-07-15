import { Schema, model, Document, Types } from 'mongoose';
import {
  MessageStatusEnum,
  MessageTypeEnum,
} from '../interfaces/message.interface';

export interface IAttachment {
  uploadId: string;
  context: 'dm-image' | 'dm-video' | 'dm-audio' | 'dm-file';
  mimeType: string;
  fileSize: number;
  status: 'processing' | 'ready' | 'failed' | 'infected';
  variants: {
    original?: string;
    thumb?: string;
    medium?: string;
    hls?: string;
    thumbnail?: string;
  } | null;
  originalName?: string;
  duration?: number;
}

export interface IMessage extends Document {
  sender: Types.ObjectId;
  conversation: Types.ObjectId;
  content?: string;
  type: MessageTypeEnum;
  status: MessageStatusEnum;
  attachments: IAttachment[];
  timestamp: Date;
  edited_at?: Date;
}

const AttachmentSchema = new Schema<IAttachment>(
  {
    uploadId: { type: String, required: true },
    context: {
      type: String,
      enum: ['dm-image', 'dm-video', 'dm-audio', 'dm-file'],
      required: true,
    },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    status: {
      type: String,
      enum: ['processing', 'ready', 'failed', 'infected'],
      default: 'processing',
    },
    variants: { type: Schema.Types.Mixed, default: null },
    originalName: { type: String },
    duration: { type: Number },
  },
  { _id: false },
);

const MessageSchema = new Schema<IMessage>({
  sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  conversation: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  },
  content: { type: String },
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
  attachments: { type: [AttachmentSchema], default: [] },
  timestamp: { type: Date, default: Date.now },
  edited_at: { type: Date },
});

MessageSchema.pre('validate', function () {
  if (!this.content?.trim() && !this.attachments?.length) {
    throw new Error('Message must have either text content or attachments.');
  }
});

// cap at 10 attachments per message
MessageSchema.pre('save', function () {
  if (this.attachments?.length > 10) {
    throw new Error('Maximum 10 attachments per message.');
  }
});

export const Message = model<IMessage>('Message', MessageSchema);
