// import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
// import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
// import { randomUUID } from 'crypto';
// import path from 'path';
// import { s3 } from '../utils/s3';
// import {
//   PRESIGNED_GET_EXPIRY,
//   PRESIGNED_PUT_EXPIRY,
//   TEMP_BUCKET,
// } from '../config/upload.config';
// import { FileInput } from './upload.validation';

// export interface PresignedFile {
//   key: string;
//   uploadUrl: string;
//   originalName: string;
//   mimeType: string;
// }

// export interface ConfirmedFile {
//   key: string;
//   url: string;
//   originalName: string;
//   mimeType: string;
// }

// export async function generatePresignedPuts(
//   files: FileInput[],
// ): Promise<PresignedFile[]> {
//   return Promise.all(
//     files.map(async (file) => {
//       const ext = path.extname(file.name);
//       const key = `uploads/${randomUUID()}${ext}`;
//       const command = new PutObjectCommand({
//         Bucket: TEMP_BUCKET,
//         Key: key,
//         ContentType: file.mimeType,
//         ContentLength: file.size,
//       });
//       const uploadUrl = await getSignedUrl(s3, command, {
//         expiresIn: PRESIGNED_PUT_EXPIRY,
//       });
//       return {
//         key,
//         uploadUrl,
//         originalName: file.name,
//         mimeType: file.mimeType,
//       };
//     }),
//   );
// }

// export async function generatePresignedGets(
//   files: {
//     key: string;
//     originalName: string;
//     mimeType: string;
//     size: number;
//   }[],
// ): Promise<ConfirmedFile[]> {
//   return Promise.all(
//     files.map(async (file) => {
//       const command = new GetObjectCommand({
//         Bucket: PERMANENT_BUCKET,
//         Key: file.key,
//       });
//       const url = await getSignedUrl(s3, command, {
//         expiresIn: PRESIGNED_GET_EXPIRY,
//       });
//       return {
//         key: file.key,
//         url,
//         originalName: file.originalName,
//         mimeType: file.mimeType,
//       };
//     }),
//   );
// }
