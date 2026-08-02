import { Document, model, Schema, Types } from 'mongoose';

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

// createNotification looks up mutes by conversation + participant set on every
// message. Left non-unique: muteConversation still guards duplicates with a
// findOne, and an existing dup would block the index from building.
MutedConversationSchema.index({ conversation: 1, user: 1 });

export const MutedConversation = model<IMutedConversation>(
  'muted_conversation',
  MutedConversationSchema,
);
