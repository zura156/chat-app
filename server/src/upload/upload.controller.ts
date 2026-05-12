import { Response } from 'express';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
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
  if (fileSize > config.maxBytes) {
    return res.status(400).json({ error: 'File too large' });
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
