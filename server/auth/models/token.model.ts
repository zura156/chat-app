import mongoose from 'mongoose';

const TokenSchema = new mongoose.Schema(
  {
    access_token: { type: String, required: true, unique: true },
    refresh_token: { type: String, required: true, unique: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    access_expiry: { type: Date, required: true },
    refresh_expiry: { type: Date, required: true },
  },
  { timestamps: true }
);

export const TokenModel = mongoose.model('AccessToken', TokenSchema);
