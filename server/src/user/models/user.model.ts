import mongoose, { Document, Schema, Types } from 'mongoose';
import bcrypt from 'bcrypt';
import validator from 'validator';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';

export interface IUser extends Document {
  first_name: string;
  last_name: string;
  username: string;
  bio: string;
  email: string;
  password: string;
  is_email_verified: boolean;
  login_attempts: number;
  lock_until?: Date;
  last_login?: Date;
  profile_picture?: string;
  status: 'offline' | 'online' | 'away';
  last_seen: Date;
  blocked_users: Types.ObjectId[];
  comparePassword(candidatePassword: string): Promise<boolean>;
  incLoginAttempts(): Promise<any>;
}

const UserSchema = new Schema<IUser>(
  {
    first_name: {
      type: String,
      required: [true, 'First name is required! \n'],
      unique: false,
    },
    last_name: {
      type: String,
      required: [true, 'Last name is required! \n'],
      unique: false,
    },
    username: {
      type: String,
      required: [true, 'Username is required! \n'],
      unique: true,
    },
    bio: {
      type: String,
      required: false,
      unique: false,
    },
    email: {
      type: String,
      required: [true, 'Email is required! \n'],
      validate: [validator.isEmail, 'Invalid email! \n'],
      createIndexes: { unique: true },
      unique: true,
    },
    is_email_verified: {
      type: Boolean,
      default: false,
    },
    login_attempts: {
      type: Number,
      default: 0,
    },
    lock_until: {
      type: Date,
      required: false,
    },
    last_login: { type: Date, required: false },
    password: {
      type: String,
      validate: [
        validator.isStrongPassword,
        'Password is not strong enough! \n It must be at least 8 characters, containing: uppercase and lowercase letters, symbols and numbers.',
      ],
      required: [true, 'Password is required! \n'],
    },
    profile_picture: {
      type: String,
    },
    status: {
      type: String,
      enum: ['offline', 'online', 'away'],
      default: 'offline',
    },
    last_seen: { type: Date, default: Date.now },
    blocked_users: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

UserSchema.pre<IUser>('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error: any) {
    next(createCustomError(error.message, error.statusCode || 500));
  }
});

UserSchema.methods.incLoginAttempts = async function () {
  if (this.lock_until && this.lock_until < Date.now()) {
    // Unlock and reset attempts
    return this.updateOne({
      $unset: { lock_until: 1 },
      $set: { login_attempts: 1 },
    });
  }

  const updates: any = { $inc: { login_attempts: 1 } };

  // If reached 5 failed attempts, and not locked yet, then lock
  if (this.login_attempts + 1 >= 5 && !this.lock_until) {
    updates.$set = {
      lock_until: new Date(Date.now() + 2 * 60 * 60 * 1000), // Lock for 2 hours
    };
  }

  return this.updateOne(updates);
};

UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model<IUser>('User', UserSchema);
