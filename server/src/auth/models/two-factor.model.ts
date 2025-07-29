import mongoose from 'mongoose';

const TwoFactorAuthSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    secret: { type: String, required: true, unique: true },
    expires_at: { type: Date, required: true },
    two_factor_enabled: { type: Boolean, required: true, default: false },
  },
  { timestamps: false }
);

export const TwoFactorAuthModel = mongoose.model(
  'two_factor_auth',
  TwoFactorAuthSchema
);
