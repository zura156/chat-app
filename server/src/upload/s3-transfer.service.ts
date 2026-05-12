import {
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { s3App, s3Quarantine } from '../config/s3';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

export async function downloadFromQuarantine(
  key: string,
  destPath: string,
): Promise<void> {
  const { Body } = await s3Quarantine.send(
    new GetObjectCommand({
      Bucket: process.env.S3_QUARANTINE_BUCKET!,
      Key: key,
    }),
  );
  await pipeline(Body as Readable, createWriteStream(destPath));
}

export async function uploadToApp(
  localPath: string,
  destKey: string,
  contentType: string,
): Promise<void> {
  const body = createReadStream(localPath);
  await s3App.send(
    new PutObjectCommand({
      Bucket: process.env.S3_APP_BUCKET!,
      Key: destKey,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function uploadBufferToApp(
  buffer: Buffer,
  destKey: string,
  contentType: string,
): Promise<void> {
  await s3App.send(
    new PutObjectCommand({
      Bucket: process.env.S3_APP_BUCKET!,
      Key: destKey,
      Body: buffer,
      ContentType: contentType,
    }),
  );
}

export async function deleteFromQuarantine(key: string): Promise<void> {
  await s3Quarantine.send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_QUARANTINE_BUCKET!,
      Key: key,
    }),
  );
}

export async function copyQuarantineToApp(
  srcKey: string,
  destKey: string,
): Promise<void> {
  await s3App.send(
    new CopyObjectCommand({
      CopySource: `${process.env.S3_QUARANTINE_BUCKET!}/${srcKey}`,
      Bucket: process.env.S3_APP_BUCKET!,
      Key: destKey,
    }),
  );
}
