import mongoose, { Schema } from 'mongoose';

export type UploadStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'infected';

const uploadSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    context: { type: String, required: true },
    resourceId: { type: String, default: null }, // groupId, postId, etc.
    fileKey: { type: String, required: true }, // key in uploads-temp
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'ready', 'failed', 'infected'],
      default: 'pending',
    },
    variants: { type: Schema.Types.Mixed, default: null }, // CDN URLs after processing
    expiresAt: { type: Date, default: null }, // for stories
  },
  { timestamps: true },
);

export const Upload = mongoose.model('Upload', uploadSchema);
