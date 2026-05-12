import ffmpeg from 'fluent-ffmpeg';
import { s3App } from '../../config/s3';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import config from '../../config/config';
import { JobPayload, ProcessResult } from './types';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, rm, readdir, readFile, mkdir } from 'fs/promises';
import { lookup } from 'mime-types';

const uploadHlsDir = async (
  localDir: string,
  bucket: string,
  s3Prefix: string,
) => {
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walk(fullPath)));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  };

  const files = await walk(localDir);

  await Promise.all(
    files.map(async (filePath) => {
      const relative = filePath.replace(localDir + '/', '');
      const s3Key = `${s3Prefix}/${relative}`;
      const body = await readFile(filePath);
      const contentType = lookup(filePath) || 'application/octet-stream';

      await s3App.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: body,
          ContentType: contentType,
        }),
      );
    }),
  );
};

const extractThumbnail = (
  inputPath: string,
  outputPath: string,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: ['00:00:01'],
        filename: 'thumb.webp',
        folder: outputPath,
        size: '640x?',
      })
      .on('end', () => resolve)
      .on('error', reject);
  });
};

const transcodeToHls = (
  inputPath: string,
  outputDir: string,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .inputOptions(['-hide_banner'])
      .complexFilter([
        '[0:v]split=2[v480][v720]',
        '[v480]scale=-2:480[out480]',
        '[v720]scale=-2:720[out720]',
      ])
      .outputOptions([
        // 480p stream
        '-map [out480]',
        '-map 0:a?',
        '-c:v:0 libx264',
        '-preset veryfast',
        '-crf 28',
        '-c:a:0 aac',
        '-b:a:0 128k',

        // 720p stream
        '-map [out720]',
        '-map 0:a?',
        '-c:v:1 libx264',
        '-preset veryfast',
        '-crf 26',
        '-c:a:1 aac',
        '-b:a:1 192k',

        '-hls_time 6',
        '-hls_playlist_type vod',
        `-hls_segment_filename ${outputDir}/%v/seg_%03d.ts`,
        '-var_stream_map',
        'v:0,a:0 v:1,a:1',
        '-master_pl_name index.m3u8',
      ])
      .output(`${outputDir}/%v/index.m3u8`)
      .on('end', () => resolve)
      .on('error', reject)
      .run();
  });
};

export const videoHandler = async (
  payload: JobPayload,
  isPublic: boolean,
): Promise<ProcessResult> => {
  const tmpBase = join(tmpdir(), payload.uploadId);
  const tmpInput = join(tmpBase, 'input');
  const tmpHls = join(tmpBase, 'hls');
  const tmpThumb = join(tmpBase, 'thumb');

  await mkdir(tmpBase, { recursive: true });
  await mkdir(tmpHls, { recursive: true });
  await mkdir(tmpThumb, { recursive: true });

  try {
    // 1. fetch raw file from uploads-temp
    const raw = await s3App.send(
      new GetObjectCommand({
        Bucket: config.s3TempBucket,
        Key: payload.fileKey,
      }),
    );
    await writeFile(
      tmpInput,
      Buffer.from(await raw.Body!.transformToByteArray()),
    );

    // 2. transcode → HLS
    await transcodeToHls(tmpInput, tmpHls);

    // 3. extract thumbnail
    await extractThumbnail(tmpInput, tmpThumb);

    // 4. determine target buckets
    const hlsBucket = isPublic ? config.s3HlsBucket : config.s3PrivateBucket;
    const thumbBucket = isPublic
      ? config.s3PublicBucket
      : config.s3PrivateBucket;
    const baseKey = `${payload.context}/${payload.userId}/${payload.uploadId}`;

    // 5. upload all HLS segments + playlists
    await uploadHlsDir(tmpHls, hlsBucket, baseKey);

    // 6. upload thumbnail
    const thumbPath = join(tmpThumb, 'thumb.webp');
    const thumbBody = await readFile(thumbPath);
    const thumbKey = `${baseKey}/thumb.webp`;

    await s3App.send(
      new PutObjectCommand({
        Bucket: thumbBucket,
        Key: thumbKey,
        Body: thumbBody,
        ContentType: 'image/webp',
      }),
    );

    // 7. build CDN URLs
    const variants = {
      hls: `${config.s3Url}/${hlsBucket}/${baseKey}/index.m3u8`,
      thumbnail: `${config.s3Url}/${thumbBucket}/${thumbKey}`,
    };

    // 8. delete raw from uploads-temp
    await s3App.send(
      new DeleteObjectCommand({
        Bucket: config.s3TempBucket,
        Key: payload.fileKey,
      }),
    );

    return { variants, finalBucket: hlsBucket, finalKey: baseKey };
  } finally {
    // always clean up tmp regardless of success/failure
    await rm(tmpBase, { recursive: true, force: true });
  }
};
