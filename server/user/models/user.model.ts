import mongoose, { Document, Schema, Types } from 'mongoose';
import bcrypt from 'bcrypt';
import validator from 'validator';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';

export interface IUser extends Document {
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  password: string;
  profile_picture?: string;
  status: 'offline' | 'online' | 'away';
  last_seen: Date;
  blocked_users: Types.ObjectId[];
  comparePassword(candidatePassword: string): Promise<boolean>;
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
    email: {
      type: String,
      required: [true, 'Email is required! \n'],
      validate: [validator.isEmail, 'Invalid email! \n'],
      createIndexes: { unique: true },
      unique: true,
    },
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

UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model<IUser>('User', UserSchema);
