import { s3App } from '../../config/s3';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { UnrecoverableError } from 'bullmq';
import config from '../../config/config';
import { CONTEXT_CONFIG } from '../../config/upload.config';
import { attachmentFor, contentTypeFor } from '../../upload/file-types';
import { Upload } from '../../upload/upload.model';
import {
  SIGNATURE_SAMPLE_BYTES,
  matchesDeclaredType,
} from '../../utils/file-signature';
import { JobPayload, ProcessResult } from './types';
import path from 'path';
import { Readable } from 'stream';

/*
 * Raw files, stored byte for byte: by the time this runs, ClamAV has passed
 * them (upload.processor.ts). Nothing about the stored object comes from the
 * upload itself (SECURITY-FIXES.md 2.3b, 2.3c):
 *
 *   - The type is the one the API accepted at presign, read from the Upload
 *     record rather than the job, and checked against today's list again.
 *   - The first bytes must fit that type.
 *   - The private object gets its type and a download disposition from here.
 *     The old copy kept whatever Content-Type the client's PUT sent, so HTML
 *     declared as text/plain was served as text/html, inline, same-site.
 *
 * A refusal is an UnrecoverableError: a retry reads the same bytes and the same
 * record. isFinalAttempt counts it as final, so the upload is marked failed.
 *
 * The magic-byte check lives here rather than in processUpload, where the plan
 * put it: this handler is dm-file's alone, and one record read serves both the
 * check and the headers.
 */
export const fileHandler = async (
  payload: JobPayload,
): Promise<ProcessResult> => {
  const upload = await Upload.findById(payload.uploadId, {
    mimeType: 1,
  }).lean();
  if (!upload) throw new UnrecoverableError('Upload record not found');

  const { mimeType } = upload;
  if (!CONTEXT_CONFIG['dm-file'].allowedMimes.includes(mimeType)) {
    throw new UnrecoverableError(`${mimeType} is not an accepted file type`);
  }

  const head = await readHead(payload.fileKey);
  if (!matchesDeclaredType(mimeType, head)) {
    throw new UnrecoverableError(`File content does not match ${mimeType}`);
  }

  // The extension is the API's own, from the declared type (presign).
  // signPrivateUrl forces the same headers on every read (upload/file-types.ts).
  const ext = path.extname(payload.fileKey);
  const finalKey = `${payload.context}/${payload.userId}/${payload.uploadId}/original${ext}`;

  // A GET then a PUT rather than CopyObject: SeaweedFS 4.13 takes a REPLACE
  // copy's x-amz-meta-* but keeps the source's Content-Type and sets no
  // Content-Disposition, so a copy would store the client's type after all.
  // The bytes stream through; nothing holds the whole file.
  const source = await s3App.send(
    new GetObjectCommand({ Bucket: config.s3TempBucket, Key: payload.fileKey }),
  );
  await s3App.send(
    new PutObjectCommand({
      Bucket: config.s3PrivateBucket,
      Key: finalKey,
      Body: source.Body as Readable,
      // A stream has no length of its own, and S3 wants one up front.
      ContentLength: source.ContentLength,
      ContentType: contentTypeFor(mimeType),
      ContentDisposition: attachmentFor(mimeType),
    }),
  );

  await s3App.send(
    new DeleteObjectCommand({
      Bucket: config.s3TempBucket,
      Key: payload.fileKey,
    }),
  );

  const variants = {
    original: `${config.s3Url}/${config.s3PrivateBucket}/${finalKey}`,
  };
  return { variants, finalBucket: config.s3PrivateBucket, finalKey };
};

/** The first bytes of the temp object, for the signature check. */
const readHead = async (key: string): Promise<Uint8Array> => {
  const object = await s3App.send(
    new GetObjectCommand({
      Bucket: config.s3TempBucket,
      Key: key,
      Range: `bytes=0-${SIGNATURE_SAMPLE_BYTES - 1}`,
    }),
  );
  return object.Body ? object.Body.transformToByteArray() : new Uint8Array();
};
