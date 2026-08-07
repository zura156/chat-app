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

/**
 * Every refusal in this file, in the shape the rest of the API uses.
 *
 * These routes answered `{ error }` while all ~90 other responses in the server
 * answer `{ message }`. The client reads `message`, so a rejected upload — "File
 * too large", "File type not allowed", the two the user can actually do
 * something about — arrived with no readable text at all, and the picker fell
 * back to printing Angular's `Http failure response for …: 400 Bad Request`.
 *
 * `error` is kept alongside so nothing that already reads it breaks.
 */
const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ message, error: message });

/** How long an unconfirmed upload record is kept before the TTL index reaps it. */
const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * File extension for a stored object. Deriving it from the mime subtype gave
 * keys like `original.vnd.openxmlformats-officedocument.wordprocessingml.document`
 * for anything but plain image and video types.
 */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'audio/webm': 'weba',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/x-7z-compressed': '7z',
  'application/x-rar-compressed': 'rar',
};

const extensionFor = (mimeType: string): string =>
  EXTENSIONS[mimeType] ?? 'bin';

/**
 * A mime type as a person would name it — `.docx` rather than
 * `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
 * which is what a refusal message would otherwise have to quote.
 */
const describeType = (mimeType: string): string => {
  const extension = EXTENSIONS[mimeType];
  if (extension) return `.${extension}`;
  return mimeType ? mimeType.split('/')[1] || mimeType : 'unknown';
};

/** Sizes in the units the limits are written in, so the two can be compared. */
const formatBytes = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb * 10) / 10}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
};

const validateResourceAccess = async (
  context: string,
  resourceId: string | undefined | null,
  userId: string | undefined,
): Promise<{ status: number; error: string } | null> => {
  if (context !== 'group-avatar') return null;

  if (!resourceId || !Types.ObjectId.isValid(resourceId)) {
    return { status: 400, error: 'A valid resourceId is required' };
  }

  const conversation =
    await Conversation.findById(resourceId).select('participants');
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
    return fail(res, 400, 'Invalid context');
  }

  // 2. Validate mime type (whitelist)
  // The refused type and the accepted ones are both named: "File type not
  // allowed" told the user nothing about which file or what to send instead.
  if (!config.allowedMimes.includes(mimeType)) {
    return fail(
      res,
      400,
      `${describeType(mimeType)} files are not accepted here. Allowed: ${config.allowedMimes
        .map(describeType)
        .filter((label, index, all) => all.indexOf(label) === index)
        .join(', ')}.`,
    );
  }

  // 3. Validate file size
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return fail(res, 400, 'That file appears to be empty.');
  }

  if (fileSize > config.maxBytes) {
    return fail(
      res,
      400,
      `That file is ${formatBytes(fileSize)}, over the ${formatBytes(
        config.maxBytes,
      )} limit for this kind of upload.`,
    );
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
    return fail(res, resourceError.status, resourceError.error);
  }

  // 4. Generate unique file key — never use original filename
  const uploadId = randomUUID();
  const fileKey = `${context}/${userId}/${uploadId}/original.${extensionFor(mimeType)}`;

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

  /*
   * Checked before it reaches the query, not after. A JSON body can carry an
   * object where this expects a string, and an unvalidated one is spliced
   * straight into the filter — `mongoSanitize` strips `$`-prefixed keys, so
   * the operator forms are already dead, but relying on a middleware two files
   * away to keep a query well-formed is a thin guarantee to hang a lookup on.
   * A malformed id also reached Mongoose's cast and came back as a 500, which
   * is the wrong answer to a bad request.
   */
  if (typeof uploadId !== 'string' || !Types.ObjectId.isValid(uploadId)) {
    return fail(res, 400, 'A valid uploadId is required');
  }

  const upload = await Upload.findOne({ _id: uploadId, userId });

  if (!upload) {
    return fail(res, 404, 'Upload not found');
  }

  if (upload.status !== 'pending') {
    return fail(res, 400, 'Upload already confirmed');
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
      return fail(res, 400, 'File not found in storage. Upload it first.');
    }
    if (e?.$metadata?.httpStatusCode !== 403) {
      // unexpected error
      return fail(res, 500, 'Storage check failed.');
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

  if (!userId) return fail(res, 401, 'Unauthorized');

  if (!uploadId) return fail(res, 400, 'Upload ID required');

  // find the upload record
  const upload = await Upload.findById(uploadId);
  if (!upload) return fail(res, 404, 'Upload not found');
  if (upload.status !== 'ready') return fail(res, 400, 'Upload not ready');

  // Public-bucket objects are served straight from the CDN and need no
  // signature — but they are still someone's upload, so the record has to
  // belong to the caller. This branch previously answered for any upload id.
  if (!PRIVATE_CONTEXTS.includes(upload.context)) {
    if (upload.userId?.toString() !== userId.toString()) {
      return fail(res, 403, 'Access denied');
    }
    return res.json({ variants: upload.variants });
  }

  if (!upload.variants || typeof upload.variants !== 'object') {
    return fail(res, 409, 'Upload has no variants');
  }

  // security: verify requesting user is participant in the conversation
  const message = await Message.findOne(
    { 'attachments.uploadId': uploadId },
    { conversation: 1 },
  ).populate('conversation', 'participants');

  if (!message) return fail(res, 404, 'Message not found');

  const conversation = message.conversation as any;
  const isParticipant = conversation.participants
    .map((p: any) => p.toString())
    .includes(userId.toString());

  if (!isParticipant) return fail(res, 403, 'Access denied');

  // generate signed URLs for all variants
  const signedVariants: Record<string, string> = {};

  for (const [name, url] of Object.entries(
    upload.variants as Record<string, string>,
  )) {
    // Prefix-stripping, not substring replacement: `String.replace` with a
    // string removes the first occurrence *anywhere*, so a URL that merely
    // contained the prefix would be mangled rather than skipped.
    const prefix = `${appConfig.s3Url}/${appConfig.s3PrivateBucket}/`;
    if (!url.startsWith(prefix)) continue;
    const key = url.slice(prefix.length);

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
