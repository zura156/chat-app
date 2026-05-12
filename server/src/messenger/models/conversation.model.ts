import { model, Schema, Types, Document } from 'mongoose';

export interface IReadReceipt {
  user_id: Types.ObjectId;
  last_message_read_id?: Types.ObjectId; // ← was string, should be ObjectId ref
  read_at: Date;
}

export interface IConversation extends Document {
  created_by?: Types.ObjectId;
  participants: Types.ObjectId[];
  last_message?: Types.ObjectId;
  read_receipts: IReadReceipt[];
  is_group: Boolean;
  group_name?: string;
  group_picture?: string;
  group_picture_variants?: {
    thumb?: string;
    medium?: string;
    large?: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    created_by: { type: Schema.Types.ObjectId, ref: 'User' }, // ← remove required: true, DMs have no creator
    participants: [
      { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ],
    last_message: { type: Schema.Types.ObjectId, ref: 'Message' },
    read_receipts: [
      {
        _id: false,
        user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        last_message_read_id: { type: Schema.Types.ObjectId, ref: 'Message' }, // ← ObjectId
        read_at: { type: Date, default: Date.now }, // ← was now() which is evaluated once at schema load
      },
    ],
    is_group: { type: Boolean, default: false },
    group_name: { type: String },
    group_picture: { type: String },
    group_picture_variants: {
      thumb: { type: String },
      medium: { type: String },
      large: { type: String },
    },
  },
  { timestamps: true },
);

// prevent DM duplicates
ConversationSchema.index(
  { participants: 1 },
  { unique: true, partialFilterExpression: { is_group: false } },
);

// common queries
ConversationSchema.index({ participants: 1, updatedAt: -1 });
ConversationSchema.index({ 'read_receipts.user_id': 1 });

export const Conversation = model<IConversation>(
  'Conversation',
  ConversationSchema,
);
