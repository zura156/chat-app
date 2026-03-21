import { S3Client } from '@aws-sdk/client-s3';
import config from '../config/config';

export const s3 = new S3Client({
  region: 'eu-georgia', // MinIO ignores this, SDK requires it
  endpoint: config.s3Url,
  credentials: {
    accessKeyId: config.s3AccessKey,
    secretAccessKey: config.s3SecretKey,
  },
  forcePathStyle: true, // required for MinIO
});
