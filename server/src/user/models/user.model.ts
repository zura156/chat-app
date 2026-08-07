import mongoose, { Document, Schema, Types } from 'mongoose';
import bcrypt from 'bcrypt';
import validator from 'validator';
import appConfig from '../../config/config';
import {
  PASSWORD_MIN_LENGTH,
  isPasswordAcceptable,
} from '../../auth/services/password-policy';

export interface IUser extends Document {
  first_name: string;
  last_name: string;
  username: string;
  bio?: string;
  email: string;
  /** Requested address, awaiting proof of control. See the schema field. */
  pending_email?: string;
  password: string;
  is_email_verified: boolean;
  login_attempts: number;
  lock_until?: Date;
  last_login?: Date;
  pfp_url?: string;
  pfp_variants?: {
    thumb?: string;
    medium?: string;
    large?: string;
  };
  cover_url?: string;
  cover_variants?: {
    thumb?: string;
    medium?: string;
    large?: string;
  };
  status: 'offline' | 'online' | 'away';
  last_seen: Date;
  blocked_users: Types.ObjectId[];
  privacy: IPrivacySettings;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

/**
 * Who may see a given field. `contacts` means people this user shares a
 * conversation with — the only relationship the app actually models, so it is
 * what "contacts" has to mean here.
 */
export type Visibility = 'everyone' | 'contacts' | 'nobody';

export const VISIBILITIES: Visibility[] = ['everyone', 'contacts', 'nobody'];

export interface IPrivacySettings {
  last_seen: Visibility;
  pfp_url: Visibility;
  bio: Visibility;
  online_status: Visibility;
}

/** The keys the settings screen offers, and the only ones a PATCH may set. */
export const PRIVACY_KEYS: (keyof IPrivacySettings)[] = [
  'last_seen',
  'pfp_url',
  'bio',
  'online_status',
];

const visibilityField = {
  type: String,
  enum: VISIBILITIES,
  default: 'everyone' as Visibility,
};

const UserSchema = new Schema<IUser>(
  {
    first_name: { type: String, required: [true, 'First name is required'] },
    last_name: { type: String, required: [true, 'Last name is required'] },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
    },
    bio: { type: String },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      validate: [validator.isEmail, 'Invalid email'],
    },
    is_email_verified: { type: Boolean, default: false },
    /**
     * An address the user has asked to move to but has not yet proved they
     * control. Kept apart from `email` so a typo — or someone else's address
     * entered by mistake — cannot lock the account out of its own inbox before
     * the link is clicked. Deliberately not `unique`: two accounts may both
     * have an unconfirmed claim on the same address, and only the one that
     * redeems its token first gets it.
     */
    pending_email: { type: String },
    login_attempts: { type: Number, default: 0 },
    lock_until: { type: Date },
    last_login: { type: Date },
    /*
     * Never loaded unless a query asks for it with `.select('+password')`.
     *
     * Without this the bcrypt hash rode along on every `findById`/`findOne`
     * that had no projection — a dozen call sites, none of which needed it —
     * and stayed one careless `res.json(user)` away from being served. The
     * read paths that *do* return a user all project explicitly today, so this
     * is the backstop for the one that forgets to.
     *
     * Verified against a real mongod before switching: an existing document
     * loaded without this path saves cleanly (the `required` and
     * `isStrongPassword` validators are skipped for unselected paths) and the
     * stored hash is left untouched, so the many `user.save()` calls that only
     * touch other fields are unaffected. `IUser.password` is deliberately left
     * non-optional — every consumer that reads it selects it, and widening the
     * type would only push a null check into code that cannot reach one.
     */
    password: {
      type: String,
      required: [true, 'Password is required'],
      select: false,
      /*
       * The same policy the router and the Angular form apply, rather than a
       * third opinion. This was `validator.isStrongPassword`, whose defaults
       * demanded a mixture of character types from a symbol set that matched
       * neither of the other two — so a password could satisfy the form, be
       * refused by the router, or satisfy both and be refused here as a raw
       * ValidationError (which reaches the client as a 500).
       *
       * Context-free by necessity: a validator cannot see the username on an
       * update, so "does this contain your own name" is checked at the routes,
       * which can. This is the floor that no write path can bypass.
       */
      validate: {
        validator: (value: string) => isPasswordAcceptable(value),
        message: () =>
          `Password must be at least ${PASSWORD_MIN_LENGTH} characters and must not be a common or predictable one.`,
      },
    },

    pfp_url: { type: String },
    pfp_variants: {
      thumb: { type: String },
      medium: { type: String },
      large: { type: String },
    },
    cover_url: { type: String },
    // The same three the image handler produces, not the `sm`/`md` this used to
    // declare — names nothing generated and nothing wrote, so the field could
    // only ever have been empty.
    cover_variants: {
      thumb: { type: String },
      medium: { type: String },
      large: { type: String },
    },

    status: {
      type: String,
      enum: ['offline', 'online', 'away'],
      default: 'offline',
    },
    last_seen: { type: Date, default: Date.now },
    blocked_users: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    privacy: {
      last_seen: visibilityField,
      pfp_url: visibilityField,
      bio: visibilityField,
      online_status: visibilityField,
    },
  },
  { timestamps: true },
);

UserSchema.index(
  { first_name: 'text', last_name: 'text', username: 'text' },
  {
    weights: { username: 10, first_name: 5, last_name: 5 },
    name: 'user_search_index',
  },
);

UserSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(appConfig.bcryptRounds);
  this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model<IUser>('User', UserSchema);
