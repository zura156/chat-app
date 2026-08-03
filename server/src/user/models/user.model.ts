import mongoose, { Document, Schema, Types } from 'mongoose';
import bcrypt from 'bcrypt';
import validator from 'validator';

export interface IUser extends Document {
  first_name: string;
  last_name: string;
  username: string;
  bio?: string;
  email: string;
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
    sm?: string;
    md?: string;
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
    login_attempts: { type: Number, default: 0 },
    lock_until: { type: Date },
    last_login: { type: Date },
    password: {
      type: String,
      required: [true, 'Password is required'],
      validate: [
        validator.isStrongPassword,
        'Password must be 8+ chars with uppercase, lowercase, numbers, and symbols',
      ],
    },

    pfp_url: { type: String },
    pfp_variants: {
      thumb: { type: String },
      medium: { type: String },
      large: { type: String },
    },
    cover_url: { type: String },
    cover_variants: {
      sm: { type: String },
      md: { type: String },
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
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model<IUser>('User', UserSchema);
