import mongoose from 'mongoose';

const PasswordResetTokenSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    token: { type: String, required: true, unique: true },
    expires_at: { type: Date, required: true },
  },
  { timestamps: true }
);

export const PasswordResetTokenModel = mongoose.model(
  'password_reset_tokens',
  PasswordResetTokenSchema
);
