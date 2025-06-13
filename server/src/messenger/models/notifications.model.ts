import { model, Schema, Types } from 'mongoose';

export interface INotification extends Document {
  user: Types.ObjectId;
  conversation: Types.ObjectId;
  unread_count: number;
}

const NotificationSchema = new Schema<INotification>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  conversation: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  },
  unread_count: { type: Number, default: 0 },
});

export const Notification = model<INotification>(
  'Notification',
  NotificationSchema
);
