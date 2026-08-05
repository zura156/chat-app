import { model, Schema, Types, Document } from 'mongoose';

export interface IReadReceipt {
  user_id: Types.ObjectId;
  last_message_read_id?: Types.ObjectId; // ← was string, should be ObjectId ref
  read_at: Date;
}

/**
 * Deterministic key for 1:1 conversations: sorted participant ids joined by ':'.
 * A unique index on `participants` itself does NOT work — a unique *multikey*
 * index enforces uniqueness per array element across documents, so the second
 * DM containing a given user would fail with E11000.
 */
export const buildDmKey = (participants: (Types.ObjectId | string)[]): string =>
  participants
    .map((p) => p.toString())
    .sort()
    .join(':');

export interface IConversation extends Document {
  created_by?: Types.ObjectId;
  participants: Types.ObjectId[];
  last_message?: Types.ObjectId;
  read_receipts: IReadReceipt[];
  is_group: boolean;
  dm_key?: string;
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
    dm_key: { type: String },
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

// prevent DM duplicates — scalar key, so uniqueness applies to the pair, not
// to each participant individually (see buildDmKey above)
ConversationSchema.index(
  { dm_key: 1 },
  { unique: true, partialFilterExpression: { dm_key: { $type: 'string' } } },
);

// common queries
ConversationSchema.index({ participants: 1, updatedAt: -1 });

/*
 * There is deliberately no unique index on `{_id, 'read_receipts.user_id'}`.
 *
 * One used to be declared here, and it could never fire. `_id` is already
 * unique per document, so the constraint says nothing across documents; and
 * *within* a document MongoDB de-duplicates multikey index keys rather than
 * rejecting them, so two receipts from the same user were always allowed. The
 * code that wrote receipts caught E11000 and treated it as "someone else won
 * the race" — a branch that could not be reached, in place of the guarantee it
 * was standing in for.
 *
 * Uniqueness is instead enforced where the write happens, with a single
 * positional-or-push update (see upsertReadReceipt below).
 */

export const Conversation = model<IConversation>(
  'Conversation',
  ConversationSchema,
);

/**
 * Records one user's read position, creating the entry or advancing it, in a
 * single round trip and without a race.
 *
 * The previous shape was: update-if-present, then push-if-that-matched-nothing,
 * then catch a duplicate-key error and retry the update. Two concurrent
 * receipts could both fall through to the push, and the index meant to stop
 * them from landing twice never fired (see the note above the indexes), so a
 * user could end up with several receipts in the same conversation — after
 * which `receipts.find(...)` reads whichever happens to come first and the
 * unread count derives from an arbitrary one of them.
 *
 * `arrayFilters` does the whole thing as one operation: it updates the matching
 * element if there is one. The push is guarded by a filter that no longer
 * matches once an entry exists, so a loser in a race writes nothing rather than
 * duplicating.
 */
export const upsertReadReceipt = async (
  conversationId: Types.ObjectId | string,
  userId: Types.ObjectId,
  lastMessageReadId: Types.ObjectId,
  readAt: Date,
): Promise<IConversation | null> => {
  const advanced = await Conversation.findOneAndUpdate(
    { _id: conversationId, 'read_receipts.user_id': userId },
    {
      $set: {
        'read_receipts.$[entry].last_message_read_id': lastMessageReadId,
        'read_receipts.$[entry].read_at': readAt,
      },
    },
    {
      arrayFilters: [{ 'entry.user_id': userId }],
      returnDocument: 'after',
      projection: 'participants',
    },
  );

  if (advanced) return advanced;

  // No entry yet. The filter makes this a no-op if one appeared in between,
  // which is what keeps concurrent first-receipts from both pushing.
  return Conversation.findOneAndUpdate(
    { _id: conversationId, 'read_receipts.user_id': { $ne: userId } },
    {
      $push: {
        read_receipts: {
          user_id: userId,
          last_message_read_id: lastMessageReadId,
          read_at: readAt,
        },
      },
    },
    { returnDocument: 'after', projection: 'participants' },
  );
};
