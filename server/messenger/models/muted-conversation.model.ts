import { model, Schema, Types } from 'mongoose';

export interface IMutedConversation extends Document {
  user: Types.ObjectId;
  conversation: Types.ObjectId;
  muted_until: Date;
}

const MutedConversationSchema = new Schema<IMutedConversation>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  conversation: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  },
  muted_until: { type: Date }, // Optional: Auto-unmute after a time
});

export const MutedConversation = model<IMutedConversation>(
  'muted_conversation',
  MutedConversationSchema
);
