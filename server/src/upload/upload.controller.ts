import { Response } from 'express';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { Upload } from './upload.model';
import { uploadQueue } from '../config/queue';
import { CONTEXT_CONFIG } from '../config/upload.config';
import { PresignRequest } from './upload.types';
import { AuthRequest } from '../auth/middlewares/auth.middleware';
import { s3App as s3, s3App } from '../config/s3';
import appConfig from '../config/config';
import { Message } from '../messenger/models/message.model';
import { Conversation } from '../messenger/models/conversation.model';
import { Types } from 'mongoose';

/** Contexts whose objects live in the private bucket and need signed reads. */
const PRIVATE_CONTEXTS = ['dm-image', 'dm-video', 'dm-file', 'dm-audio'];

/** How long an unconfirmed upload record is kept before the TTL index reaps it. */
const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

const validateResourceAccess = async (
  context: string,
  resourceId: string | undefined | null,
  userId: string | undefined,
): Promise<{ status: number; error: string } | null> => {
  if (context !== 'group-avatar') return null;

  if (!resourceId || !Types.ObjectId.isValid(resourceId)) {
    return { status: 400, error: 'A valid resourceId is required' };
  }

  const conversation = await Conversation.findById(resourceId).select(
    'participants',
  );
  if (!conversation) {
    return { status: 404, error: 'Conversation not found' };
  }

  const isParticipant = conversation.participants
    .map((p) => p.toString())
    .includes(String(userId));

  return isParticipant
    ? null
    : { status: 403, error: 'Access denied to this conversation' };
};

export const presign = async (req: AuthRequest, res: Response) => {
  const { context, mimeType, fileSize, resourceId } =
    req.body as PresignRequest;
  const userId = req.user?._id; // from auth middleware

  // 1. Validate context
  const config = CONTEXT_CONFIG[context];
  if (!config) {
    return res.status(400).json({ error: 'Invalid context' });
  }

  // 2. Validate mime type (whitelist)
  if (!config.allowedMimes.includes(mimeType)) {
    return res.status(400).json({ error: 'File type not allowed' });
  }

  // 3. Validate file size
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return res.status(400).json({ error: 'Invalid file size' });
  }

  if (fileSize > config.maxBytes) {
    return res.status(400).json({ error: 'File too large' });
  }

  // 3b. Validate the caller may write to the resource this upload targets.
  // Without this anyone can replace any group's picture by presigning a
  // 'group-avatar' with someone else's conversation id.
  const resourceError = await validateResourceAccess(
    context,
    resourceId,
    userId?.toString(),
  );
  if (resourceError) {
    return res.status(resourceError.status).json({ error: resourceError.error });
  }

  // 4. Generate unique file key — never use original filename
  const uploadId = randomUUID();
  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const fileKey = `${context}/${userId}/${uploadId}/original.${ext}`;

  // 5. Generate presigned PUT URL
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: fileKey,
    ContentType: mimeType,
    ContentLength: fileSize, // enforces exact size — rejects if different
  });

  const presignedUrl = await getSignedUrl(s3, command, {
    expiresIn: config.expiresIn,
  });

  // 6. Create pending upload record
  const upload = await Upload.create({
    _id: uploadId,
    userId,
    context,
    resourceId: resourceId ?? null,
    fileKey,
    mimeType,
    fileSize,
    status: 'pending',
    // dropped by the TTL index if the client never confirms
    expiresAt: new Date(Date.now() + PENDING_UPLOAD_TTL_MS),
  });

  return res.json({
    uploadId: upload._id,
    presignedUrl,
    fileKey,
    expiresIn: config.expiresIn,
  });
};

export const confirm = async (req: AuthRequest, res: Response) => {
  const { uploadId } = req.body;
  const userId = req.user?._id;

  const upload = await Upload.findOne({ _id: uploadId, userId });

  if (!upload) {
    return res.status(404).json({ error: 'Upload not found' });
  }

  if (upload.status !== 'pending') {
    return res.status(400).json({ error: 'Upload already confirmed' });
  }

  try {
    await s3App.send(
      new HeadObjectCommand({
        Bucket: appConfig.s3TempBucket,
        Key: upload.fileKey,
      }),
    );
  } catch (e: any) {
    // 403 = file exists but metadata access denied (SeaweedFS IAM quirk) — allow
    // 404 = file genuinely doesn't exist — reject
    if (e?.$metadata?.httpStatusCode === 404) {
      return res
        .status(400)
        .json({ error: 'File not found in storage. Upload it first.' });
    }
    if (e?.$metadata?.httpStatusCode !== 403) {
      // unexpected error
      return res.status(500).json({ error: 'Storage check failed.' });
    }
    // 403 → file exists, continue
  }

  // Mark as processing
  upload.status = 'processing';
  await upload.save();

  // Enqueue worker job
  await uploadQueue.add(
    'process-upload',
    {
      uploadId: upload._id,
      userId: upload.userId,
      context: upload.context,
      resourceId: upload.resourceId,
      fileKey: upload.fileKey,
      mimeType: upload.mimeType,
    },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  );

  return res.json({ ok: true });
};

// GET /upload/signed-url/:uploadId
export const getSignedDownloadUrl = async (req: AuthRequest, res: Response) => {
  const { uploadId } = req.params;
  const userId = req.user?._id;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  if (!uploadId) return res.status(400).json({ error: 'Upload ID required' });

  // find the upload record
  const upload = await Upload.findById(uploadId);
  if (!upload) return res.status(404).json({ error: 'Upload not found' });
  if (upload.status !== 'ready')
    return res.status(400).json({ error: 'Upload not ready' });

  // only private bucket needs signed URLs
  // public bucket files are served directly via CDN
  if (!PRIVATE_CONTEXTS.includes(upload.context)) {
    return res.json({ variants: upload.variants });
  }

  if (!upload.variants || typeof upload.variants !== 'object') {
    return res.status(409).json({ error: 'Upload has no variants' });
  }

  // security: verify requesting user is participant in the conversation
  const message = await Message.findOne(
    { 'attachments.uploadId': uploadId },
    { conversation: 1 },
  ).populate('conversation', 'participants');

  if (!message) return res.status(404).json({ error: 'Message not found' });

  const conversation = message.conversation as any;
  const isParticipant = conversation.participants
    .map((p: any) => p.toString())
    .includes(userId.toString());

  if (!isParticipant) return res.status(403).json({ error: 'Access denied' });

  // generate signed URLs for all variants
  const signedVariants: Record<string, string> = {};

  for (const [name, url] of Object.entries(
    upload.variants as Record<string, string>,
  )) {
    // extract the key from the stored URL
    const key = url.replace(
      `${appConfig.s3Url}/${appConfig.s3PrivateBucket}/`,
      '',
    );

    const command = new GetObjectCommand({
      Bucket: appConfig.s3PrivateBucket,
      Key: key,
    });

    signedVariants[name] = await getSignedUrl(s3App, command, {
      expiresIn: 900,
    }); // 15min
  }

  return res.json({ variants: signedVariants });
};
