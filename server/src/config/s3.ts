import { S3Client } from '@aws-sdk/client-s3';
import config from './config';

export const s3App = new S3Client({
  endpoint: config.s3Url,
  credentials: {
    accessKeyId: config.s3AccessKey,
    secretAccessKey: config.s3SecretKey,
  },
  forcePathStyle: true, // required for Seaweed
});

export const s3Quarantine = new S3Client({
  endpoint: config.s3Url,
  credentials: {
    accessKeyId: config.s3QuarantineAccessKey,
    secretAccessKey: config.s3QuarantineSecretKey,
  },
  forcePathStyle: true, // required for Seaweed
});
