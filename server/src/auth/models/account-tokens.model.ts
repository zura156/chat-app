import mongoose from 'mongoose';

export enum AccountTokenEnum {
  PASSWORD_RESET = 'password_reset',
  EMAIL_VERIFICATION = 'email_verification',
  UNLOCK_ACCOUNT = 'unlock_account',
  /**
   * Proves control of a *new* address before it replaces the current one.
   * Distinct from EMAIL_VERIFICATION, which proves control of the address the
   * account already has: sharing one type would let a pending verification
   * token be redeemed to complete an address change, and vice versa.
   */
  EMAIL_CHANGE = 'email_change',
}

const AccountTokensSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(AccountTokenEnum),
      required: true,
    },
    token: { type: String, required: true, unique: true },
    expires_at: { type: Date, required: true },
  },
  { timestamps: true },
);

export const AccountTokensModel = mongoose.model(
  'account_tokens',
  AccountTokensSchema,
);
