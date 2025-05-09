import mongoose, { Document, Schema } from 'mongoose';

export interface UserContactDocument extends Document {
  userId: string;
  contactId: string;
  status: 'pending' | 'accepted' | 'blocked';
  createdAt: Date;
  updatedAt: Date;
}

const userContactSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    contactId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'blocked'],
      default: 'pending',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

userContactSchema.index({ userId: 1, contactId: 1 }, { unique: true });

userContactSchema.pre('save', function (next) {
  if (this.userId.toString() === this.contactId.toString()) {
    const error = new Error('Users cannot add themselves as contacts');
    return next(error);
  }
  next();
});

export const UserContact = mongoose.model<UserContactDocument>(
  'UserContact',
  userContactSchema
);
