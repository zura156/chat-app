import { Document, model, Schema, Types } from 'mongoose';

export interface INotification extends Document {
  user: Types.ObjectId;
  conversation: Types.ObjectId;
  /**
   * Cache of a value derived from the messages collection, never a running
   * total — see deriveUnreadCount. Kept here so the list can be served without
   * a per-conversation count, and refreshed on every read.
   */
  unread_count: number;
  seen: boolean;
  /**
   * When the user last dismissed this conversation. Read receipts only advance
   * when a message is actually on screen, so dismissing without opening needs
   * its own watermark — otherwise the derived count resurrects everything the
   * user already waved away.
   */
  seen_at?: Date;
}

const NotificationSchema = new Schema<INotification>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  conversation: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  },
  unread_count: { type: Number, default: 0 },
  seen: { type: Boolean, default: false },
  seen_at: { type: Date },
});

// The upsert in createNotification filters on exactly this pair. Without the
// unique constraint two concurrent messages can both miss and both insert,
// leaving duplicate counters for one conversation; without the index at all
// every upsert and every lookup is a collection scan, on every message sent.
NotificationSchema.index({ user: 1, conversation: 1 }, { unique: true });

// Backs the unfiltered `markNotificationsAsSeen` and the initial load.
NotificationSchema.index({ user: 1, seen: 1 });

export const Notification = model<INotification>(
  'Notification',
  NotificationSchema,
);
