import sharp from 'sharp';
import { s3App } from '../../config/s3';
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import config from '../../config/config';
import { JobPayload, ProcessResult } from './types';

const IMAGE_VARIANTS = {
  thumb: 64,
  medium: 400,
  large: 1200,
};

export const imageHandler = async (
  payload: JobPayload,
): Promise<ProcessResult> => {
  // 1. fetch raw file from uploads-temp
  const raw = await s3App.send(
    new GetObjectCommand({
      Bucket: config.s3TempBucket,
      Key: payload.fileKey,
    }),
  );

  const buffer = Buffer.from(await raw.Body!.transformToByteArray());

  // 2. generate variants
  const variants: Record<string, string> = {};
  const baseKey = `${payload.context}/${payload.userId}/${payload.uploadId}`;

  for (const [name, width] of Object.entries(IMAGE_VARIANTS)) {
    const processed = await sharp(buffer)
      .rotate()
      .resize(width, null, { withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();

    const key = `${baseKey}/${name}.webp`;
    await s3App.send(
      new PutObjectCommand({
        Bucket: config.s3PublicBucket,
        Key: key,
        Body: processed,
        ContentType: 'image/webp',
      }),
    );

    variants[name] = `${config.s3Url}/${config.s3PublicBucket}/${key}`;
  }

  // 3. delete from temp
  await s3App.send(
    new DeleteObjectCommand({
      Bucket: config.s3TempBucket,
      Key: payload.fileKey,
    }),
  );

  return { variants, finalBucket: config.s3PublicBucket, finalKey: baseKey };
};
