import { Response } from 'express';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
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
import { isUUID } from 'validator';
import { downloadOverrides, extensionOf } from './file-types';
import { logger } from '../utils/logger';
import path from 'path';

/** Contexts whose objects live in the private bucket and need signed reads. */
const PRIVATE_CONTEXTS = ['dm-image', 'dm-video', 'dm-file', 'dm-audio'];

const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ message, error: message });

/** How long an unconfirmed upload record is kept before the TTL index reaps it. */
const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

const extensionFor = (mimeType: string): string =>
  extensionOf(mimeType) ?? 'bin';

/**
 * A mime type as a person would name it — `.docx` rather than
 * `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
 * which is what a refusal message would otherwise have to quote.
 */
const describeType = (mimeType: string): string => {
  const extension = extensionOf(mimeType);
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
  //
  // Only headers the client's PUT sends may be signed. A Content-Disposition
  // here (1995e39) was signed too, and the client never sends one, so storage
  // refused every DM file upload with SignatureDoesNotMatch. A download header
  // belongs on the final object the worker writes (docs/SECURITY-FIXES.md 2.3c),
  // not on the temp upload. tests/upload/upload.controller.int.spec.ts pins it.
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: fileKey,
    ContentType: mimeType,
    ContentLength: fileSize, // enforces exact size — rejects if different
  });

  const presignedUrl = await getSignedUrl(s3, command, {
    expiresIn: config.expiresIn,
    // The presigner leaves Content-Type out of the signature by default, so a
    // client could presign text/plain and PUT text/html: the temp object would
    // carry whatever type the PUT chose (SECURITY-FIXES.md 2.4, H1). Signed,
    // storage refuses any other value. The client PUTs the same `file.type` it
    // presigned with, and Z's upload canary `text/plain` for `text/plain`.
    signableHeaders: new Set(['content-type']),
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

  if (typeof uploadId !== 'string' || !isUUID(uploadId)) {
    return fail(res, 400, 'A valid uploadId is required');
  }

  // Claimed in one write, so two confirms at once can't both go on. With the
  // freeze below, a second one would copy again, perhaps bytes swapped in
  // after the first, over the frozen key the first job is scanning.
  const upload = await Upload.findOneAndUpdate(
    { _id: uploadId, userId, status: 'pending' },
    { $set: { status: 'processing' } },
    { returnDocument: 'after' },
  );

  if (!upload) {
    return (await Upload.exists({ _id: uploadId, userId }))
      ? fail(res, 400, 'Upload already confirmed')
      : fail(res, 404, 'Upload not found');
  }

  const refused =
    upload.context === 'dm-file'
      ? await freeze(upload)
      : await checkStored(upload.fileKey);

  if (refused) {
    // Back to pending, so the client can upload again and confirm.
    await Upload.updateOne(
      { _id: upload._id, status: 'processing' },
      { $set: { status: 'pending' } },
    );
    return fail(res, refused.status, refused.message);
  }

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

type Refusal = { status: number; message: string };

const NOT_UPLOADED: Refusal = {
  status: 400,
  message: 'File not found in storage. Upload it first.',
};
const STORAGE_FAILED: Refusal = {
  status: 500,
  message: 'Storage check failed.',
};

/**
 * A dm-file's bytes, frozen where no presigned URL reaches (SECURITY-FIXES.md
 * 2.2). The presigned PUT stays valid for its whole lifetime after confirm, so
 * the bytes at its key could be swapped between ClamAV's scan, the worker's
 * byte check and the store, or between retries. Every presigned key starts
 * with a context name, and no context is called `frozen`.
 *
 * The record names the frozen key before the original is deleted, so it never
 * points at an object that is gone; the job, handleFailedJob and the sweeps
 * all read it from there. Here, not in the worker: a freeze there would run
 * again on each retry and copy whatever was at the original key by then.
 */
const freeze = async (
  upload: InstanceType<typeof Upload>,
): Promise<Refusal | undefined> => {
  const original = upload.fileKey;
  const frozen = `frozen/${upload._id}/original${path.extname(original)}`;

  // Checked first: SeaweedFS 4.13 answers a copy from a missing key with
  // 400 InvalidArgument, not 404, so the copy's error can't say "not uploaded".
  const missing = await checkStored(original);
  if (missing) return missing;

  try {
    await s3App.send(
      new CopyObjectCommand({
        CopySource: `${appConfig.s3TempBucket}/${original}`,
        Bucket: appConfig.s3TempBucket,
        Key: frozen,
      }),
    );
  } catch (error) {
    logger.error(`Failed to freeze temp object ${original}`, error);
    return STORAGE_FAILED;
  }

  upload.fileKey = frozen;
  await upload.save();

  // A delete that fails leaves a stray object at a key the upload no longer
  // names; the frozen bytes are safe either way.
  try {
    await s3App.send(
      new DeleteObjectCommand({
        Bucket: appConfig.s3TempBucket,
        Key: original,
      }),
    );
  } catch (error) {
    logger.error(
      `Failed to delete temp object ${original} after freezing it`,
      error,
    );
  }
  return undefined;
};

/** Other contexts are never scanned and always re-encoded: their object only
 * has to exist. */
const checkStored = async (fileKey: string): Promise<Refusal | undefined> => {
  try {
    await s3App.send(
      new HeadObjectCommand({ Bucket: appConfig.s3TempBucket, Key: fileKey }),
    );
    return undefined;
  } catch (e: any) {
    // 403 = file exists but metadata access denied (SeaweedFS IAM quirk) — allow
    // 404 = file genuinely doesn't exist — reject
    const status = e?.$metadata?.httpStatusCode;
    if (status === 404) return NOT_UPLOADED;
    if (status === 403) return undefined;
    return STORAGE_FAILED;
  }
};

/*
 * GET /upload/:uploadId/status
 *
 * Where an upload is in processing, for its owner only. Sentinel's upload
 * canary (Z, ADR 0031) reads it to learn whether ClamAV passed its clean file
 * and caught its EICAR one: the canary never attaches them to a message, so the
 * websocket events and /signed-url (which needs a message) can't tell it.
 *
 * Someone else's upload answers exactly as a missing one. Its status is
 * information about them — that a file of theirs was flagged as malware.
 */
export const getUploadStatus = async (req: AuthRequest, res: Response) => {
  const { uploadId } = req.params;
  const userId = req.user?._id;

  if (!userId) return fail(res, 401, 'Unauthorized');

  if (typeof uploadId !== 'string' || !isUUID(uploadId)) {
    return fail(res, 400, 'A valid uploadId is required');
  }

  const upload = await Upload.findOne(
    { _id: uploadId, userId },
    { status: 1 },
  ).lean();

  if (!upload) return fail(res, 404, 'Upload not found');

  return res.json({ status: upload.status });
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
    {
      conversation: 1,
      'attachments.uploadId': 1,
      'attachments.originalName': 1,
    },
  ).populate('conversation', 'participants');

  if (!message) return fail(res, 404, 'Message not found');

  const conversation = message.conversation as any;
  const isParticipant = conversation.participants
    .map((p: any) => p.toString())
    .includes(userId.toString());

  if (!isParticipant) return fail(res, 403, 'Access denied');

  // The sender's name for the file names its download (upload/file-types.ts).
  const originalName = message.attachments?.find(
    (attachment) => attachment.uploadId === uploadId,
  )?.originalName;

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
      ...downloadOverrides(key, originalName),
    });

    signedVariants[name] = await getSignedUrl(s3App, command, {
      expiresIn: 900,
    }); // 15min
  }

  return res.json({ variants: signedVariants });
};
