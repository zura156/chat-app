import ffmpeg from 'fluent-ffmpeg';
import { s3App } from '../../config/s3';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import config from '../../config/config';
import { JobPayload, ProcessResult } from './types';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, rm, readFile, mkdir } from 'fs/promises';

/*
 * Videos sent in a conversation, transcoded to a single progressive MP4.
 *
 * There used to be a second path here producing an HLS ladder — two renditions,
 * segments, a master playlist — selected by an `isPublic` flag. Nothing set it.
 * It existed for posts and stories, whose upload contexts and completion
 * handlers were removed when it became clear those features do not exist, and
 * the transcoder for them was left behind: roughly a third of this file, a
 * concurrency-limited uploader and a retry helper used by nothing, plus a
 * required `S3_BUCKET_HLS` naming a bucket no code path could write to.
 *
 * It could not have been reinstated as it stood, either. HLS cannot be served
 * from the private bucket these attachments live in — the master playlist
 * references its variant playlists and segments by relative path, and those
 * requests go out unsigned. That is why the surviving path is a single object:
 * one object needs exactly one signed URL.
 */

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
 * Single progressive MP4. MP4 also plays natively in Chrome and Firefox, which
 * HLS in a bare <video src> never did.
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

export const videoHandler = async (
  payload: JobPayload,
): Promise<ProcessResult> => {
  const tmpBase = join(tmpdir(), payload.uploadId);
  const tmpInput = join(tmpBase, 'input');
  const tmpThumb = join(tmpBase, 'thumb');
  const tmpMp4 = join(tmpBase, 'video.mp4');

  await mkdir(tmpBase, { recursive: true });
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

    // 2. thumbnail
    await extractThumbnail(tmpInput, tmpThumb, duration);

    const baseKey = `${payload.context}/${payload.userId}/${payload.uploadId}`;
    const thumbKey = `${baseKey}/thumb.webp`;
    const videoKey = `${baseKey}/video.mp4`;

    // 3. transcode and store, both in the private bucket
    await transcodeToMp4(tmpInput, tmpMp4);

    await s3App.send(
      new PutObjectCommand({
        Bucket: config.s3PrivateBucket,
        Key: videoKey,
        Body: await readFile(tmpMp4),
        ContentType: 'video/mp4',
      }),
    );

    await s3App.send(
      new PutObjectCommand({
        Bucket: config.s3PrivateBucket,
        Key: thumbKey,
        Body: await readFile(join(tmpThumb, 'thumb.webp')),
        ContentType: 'image/webp',
      }),
    );

    return {
      variants: {
        original: `${config.s3Url}/${config.s3PrivateBucket}/${videoKey}`,
        thumbnail: `${config.s3Url}/${config.s3PrivateBucket}/${thumbKey}`,
      },
      duration,
      finalBucket: config.s3PrivateBucket,
      finalKey: videoKey,
    };
  } finally {
    // always clean up tmp regardless of success/failure
    await rm(tmpBase, { recursive: true, force: true });
  }
};
