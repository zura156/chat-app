import { s3App } from '../../config/s3';
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import config from '../../config/config';
import { JobPayload, ProcessResult } from './types';
import path from 'path';

/*
 * raw files: just move from temp to private, no processing
 */
export const fileHandler = async (
  payload: JobPayload,
): Promise<ProcessResult> => {
  const ext = path.extname(payload.fileKey);
  const finalKey = `${payload.context}/${payload.userId}/${payload.uploadId}/original${ext}`;

  await s3App.send(
    new CopyObjectCommand({
      CopySource: `${config.s3TempBucket}/${payload.fileKey}`,
      Bucket: config.s3PrivateBucket,
      Key: finalKey,
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
