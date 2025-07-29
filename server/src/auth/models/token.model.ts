import mongoose from 'mongoose';

const TokenSchema = new mongoose.Schema(
  {
    refresh_tokens: [{ token: String, expires_at: Date }],
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

export const TokenModel = mongoose.model('tokens', TokenSchema);
