import { Document, model, Schema, Types } from 'mongoose';

/*
 * A mute lasts until it is undone. There is no timed mute, and nothing in the
 * UI offers one.
 *
 * `muted_until: Date` was declared here — non-optional on the interface, never
 * set by `muteConversation`, and read by nothing. So it was always `undefined`
 * while the type promised a Date, and any future code that trusted it would
 * have compared against nothing. Removed rather than implemented: an
 * unimplemented field that type-checks is worse than no field, and adding a
 * timed mute is a product decision with a UI attached.
 */
export interface IMutedConversation extends Document {
  user: Types.ObjectId;
  conversation: Types.ObjectId;
}

const MutedConversationSchema = new Schema<IMutedConversation>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  conversation: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  },
});

// createNotification looks up mutes by conversation + participant set on every
// message. Left non-unique: muteConversation still guards duplicates with a
// findOne, and an existing dup would block the index from building.
MutedConversationSchema.index({ conversation: 1, user: 1 });

export const MutedConversation = model<IMutedConversation>(
  'muted_conversation',
  MutedConversationSchema,
);
