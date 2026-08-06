import mongoose, { Document, Schema, Types } from 'mongoose';

/*
 * This model existed with no controller, no route and no reference anywhere —
 * the security screen's 2FA switch just flipped a local signal. It now backs
 * real enrolments, of which there are two kinds.
 *
 * A TOTP row is created when setup begins and is *pending* until the user
 * proves they can produce a code from it. Enabling on creation would let an
 * interrupted setup lock someone out of their own account with a secret they
 * never stored. The email factor has the same shape for the same reason: it is
 * not in force until a delivered code comes back.
 *
 * The two factors share one document and one set of recovery codes. Fields are
 * additive rather than restructured — `secret` and `two_factor_enabled` predate
 * the email factor and are what every existing row is written in, so renaming
 * them into a tidier `totp: {...}` sub-document would mean migrating live 2FA
 * enrolments to make the schema read better. `two_factor_enabled` therefore
 * means *TOTP* is on, which the accessors below exist to keep unambiguous.
 */
export interface ITwoFactorAuth extends Document {
  user_id: Types.ObjectId;
  /**
   * The TOTP secret. Optional: an account may enrol the email factor alone and
   * never hold one.
   */
  secret?: string;
  /** TOTP is confirmed and in force. */
  two_factor_enabled: boolean;
  /** While a TOTP enrolment is pending, when the secret stops being accepted. */
  expires_at?: Date;
  confirmed_at?: Date;
  /** Emailed one-time codes are confirmed and in force. */
  email_enabled: boolean;
  email_confirmed_at?: Date;
  /** Single-use fallbacks, stored hashed. Shared by both factors. */
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
    secret: { type: String },
    two_factor_enabled: { type: Boolean, required: true, default: false },
    expires_at: { type: Date },
    confirmed_at: { type: Date },
    email_enabled: { type: Boolean, required: true, default: false },
    email_confirmed_at: { type: Date },
    recovery_codes: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const TwoFactorAuthModel = mongoose.model<ITwoFactorAuth>(
  'two_factor_auth',
  TwoFactorAuthSchema,
);

/** The factors a user can be challenged with. */
export type TwoFactorMethod = 'totp' | 'email';

/**
 * Which factors are actually in force on a record.
 *
 * Every decision about the second step reads this rather than a boolean, so
 * "does this account have 2FA" and "what may this account be asked for" cannot
 * drift apart — the bug that shape prevents is a login that demands a factor
 * the user disabled, or skips one they enrolled.
 */
export const enrolledMethods = (
  record: Pick<ITwoFactorAuth, 'two_factor_enabled' | 'email_enabled'> | null,
): TwoFactorMethod[] => {
  if (!record) return [];

  const methods: TwoFactorMethod[] = [];
  if (record.two_factor_enabled) methods.push('totp');
  if (record.email_enabled) methods.push('email');
  return methods;
};

/** Whether any second factor stands between this account's password and a session. */
export const hasSecondFactor = (
  record: Pick<ITwoFactorAuth, 'two_factor_enabled' | 'email_enabled'> | null,
): boolean => enrolledMethods(record).length > 0;
