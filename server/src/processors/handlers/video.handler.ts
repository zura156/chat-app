import ffmpeg from 'fluent-ffmpeg';
import { s3App } from '../../config/s3';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import config from '../../config/config';
import { JobPayload, ProcessResult } from './types';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, rm, readdir, readFile, mkdir } from 'fs/promises';
import { lookup } from 'mime-types';

const withRetry = async <T>(
  fn: () => Promise<T>,
  attempts = 4,
  baseMs = 300,
): Promise<T> => {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const transient = [
        'EAI_AGAIN',
        'ENOTFOUND',
        'ECONNRESET',
        'ETIMEDOUT',
      ].includes(err?.code);
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) =>
        setTimeout(r, baseMs * 2 ** i + Math.random() * 100),
      );
    }
  }
  throw new Error('unreachable');
};

const mapLimit = async <T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) => {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (queue.length) {
        const item = queue.shift()!;
        await fn(item);
      }
    }),
  );
};

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

  await mapLimit(files, 10, async (filePath) => {
    const relative = filePath.replace(localDir + '/', '');
    const s3Key = `${s3Prefix}/${relative}`;
    const body = await readFile(filePath);
    const contentType = lookup(filePath) || 'application/octet-stream';

    await withRetry(() =>
      s3App.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: body,
          ContentType: contentType,
        }),
      ),
    );
  });
};

const getVideoDuration = (inputPath: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);

      const fmtDur = Number(metadata.format?.duration);
      if (Number.isFinite(fmtDur) && fmtDur > 0) {
        return resolve(Math.round(fmtDur));
      }

      // format.duration missing (fragmented mp4, MediaRecorder webm) — fall back to stream duration
      const streamDur = metadata.streams
        ?.map((s) => Number(s.duration))
        .find((d) => Number.isFinite(d) && d > 0);

      resolve(streamDur ? Math.round(streamDur) : 0);
    });
  });
};

const extractThumbnail = (
  inputPath: string,
  outputPath: string,
  duration: number,
): Promise<void> => {
  // a fixed 00:00:01 seek fails outright on sub-second clips
  const seek = duration > 1 ? '00:00:01' : '00:00:00';

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: [seek],
        filename: 'thumb.webp',
        folder: outputPath,
        size: '640x?',
      })
      .on('end', () => resolve())
      .on('error', reject);
  });
};

/**
 * Single progressive MP4, used for anything served from the private bucket.
 *
 * HLS cannot be delivered from a private bucket: the master playlist references
 * variant playlists and segments by relative path, and those requests would go
 * out unsigned. A single object needs exactly one signed URL. MP4 also plays
 * natively in Chrome and Firefox, which HLS in a bare <video src> never did.
 */
const transcodeToMp4 = (inputPath: string, outputPath: string): Promise<void> =>
  new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .inputOptions(['-hide_banner'])
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('128k')
      .outputOptions([
        '-preset veryfast',
        '-crf 26',
        '-vf scale=-2:min(720\\,ih)', // cap at 720p, never upscale
        '-pix_fmt yuv420p', // required for Safari/QuickTime
        '-movflags +faststart', // moov atom first so playback can start early
        '-max_muxing_queue_size 1024',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });

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
        '-master_pl_name index.m3u8',
      ])
      .outputOption('-var_stream_map', 'v:0,a:0 v:1,a:1')
      .output(`${outputDir}/%v/index.m3u8`)
      .on('end', () => resolve())
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
  const tmpMp4 = join(tmpBase, 'video.mp4');

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

    const duration = await getVideoDuration(tmpInput);

    // 2. thumbnail (both paths need it)
    await extractThumbnail(tmpInput, tmpThumb, duration);

    const baseKey = `${payload.context}/${payload.userId}/${payload.uploadId}`;
    const thumbBucket = isPublic
      ? config.s3PublicBucket
      : config.s3PrivateBucket;
    const thumbKey = `${baseKey}/thumb.webp`;

    const uploadThumb = async () => {
      const thumbBody = await readFile(join(tmpThumb, 'thumb.webp'));
      await s3App.send(
        new PutObjectCommand({
          Bucket: thumbBucket,
          Key: thumbKey,
          Body: thumbBody,
          ContentType: 'image/webp',
        }),
      );
    };

    // 3. private (conversation) video → single signable MP4.
    //    public (posts/stories) → HLS ladder as before.
    if (!isPublic) {
      await transcodeToMp4(tmpInput, tmpMp4);

      const videoKey = `${baseKey}/video.mp4`;
      await s3App.send(
        new PutObjectCommand({
          Bucket: config.s3PrivateBucket,
          Key: videoKey,
          Body: await readFile(tmpMp4),
          ContentType: 'video/mp4',
        }),
      );
      await uploadThumb();

      return {
        variants: {
          original: `${config.s3Url}/${config.s3PrivateBucket}/${videoKey}`,
          thumbnail: `${config.s3Url}/${thumbBucket}/${thumbKey}`,
        },
        duration,
        finalBucket: config.s3PrivateBucket,
        finalKey: videoKey,
      };
    }

    await transcodeToHls(tmpInput, tmpHls);
    await uploadHlsDir(tmpHls, config.s3HlsBucket, baseKey);
    await uploadThumb();

    const variants = {
      hls: `${config.s3Url}/${config.s3HlsBucket}/${baseKey}/index.m3u8`,
      thumbnail: `${config.s3Url}/${thumbBucket}/${thumbKey}`,
    };

    return {
      variants,
      duration,
      finalBucket: config.s3HlsBucket,
      finalKey: baseKey,
    };
  } finally {
    // always clean up tmp regardless of success/failure
    await rm(tmpBase, { recursive: true, force: true });
  }
};
