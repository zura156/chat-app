import mongoose, { Schema } from 'mongoose';

export type UploadStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'infected';

const uploadSchema = new Schema(
  {
    _id: { type: String, required: true },
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
    duration: { type: Number, default: null }, // audio/video length in seconds
    expiresAt: { type: Date, default: null }, // for stories
  },
  { _id: false, timestamps: true },
);

export const Upload = mongoose.model('Upload', uploadSchema);
