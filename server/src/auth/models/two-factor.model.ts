import mongoose, { Document, Schema, Types } from 'mongoose';

/*
 * This model existed with no controller, no route and no reference anywhere —
 * the security screen's 2FA switch just flipped a local signal. It now backs a
 * real TOTP enrolment.
 *
 * A row is created when setup begins and is *pending* until the user proves
 * they can produce a code from it. Enabling on creation would let an
 * interrupted setup lock someone out of their own account with a secret they
 * never stored.
 */
export interface ITwoFactorAuth extends Document {
  user_id: Types.ObjectId;
  secret: string;
  two_factor_enabled: boolean;
  /** While pending, when the unconfirmed secret stops being accepted. */
  expires_at?: Date;
  confirmed_at?: Date;
  /** Single-use fallbacks, stored hashed. */
  recovery_codes: string[];
}

const TwoFactorAuthSchema = new Schema<ITwoFactorAuth>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    secret: { type: String, required: true },
    two_factor_enabled: { type: Boolean, required: true, default: false },
    expires_at: { type: Date },
    confirmed_at: { type: Date },
    recovery_codes: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const TwoFactorAuthModel = mongoose.model<ITwoFactorAuth>(
  'two_factor_auth',
  TwoFactorAuthSchema,
);
