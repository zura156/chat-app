import mongoose from 'mongoose';

const EmailVerificationTokenSchema = new mongoose.Schema(
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

export const EmailVerificationTokenModel = mongoose.model(
  'email_verification_tokens',
  EmailVerificationTokenSchema
);
