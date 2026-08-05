import ffmpeg from 'fluent-ffmpeg';
import { s3App } from '../../config/s3';
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import config from '../../config/config';
import { JobPayload, ProcessResult } from './types';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, readFile, rm, mkdir } from 'fs/promises';
import { logger } from '../../utils/logger';

/**
 * Uses fluent-ffmpeg rather than shelling out to `ffprobe` directly, so it
 * honours whatever binary the worker configured instead of silently depending
 * on $PATH resolution.
 */
const getDuration = (filePath: string): Promise<number> =>
  new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        logger.error('ffprobe failed for audio duration', err);
        return resolve(0);
      }

      const fmtDur = Number(metadata?.format?.duration);
      if (Number.isFinite(fmtDur) && fmtDur > 0) return resolve(fmtDur);

      const streamDur = metadata?.streams
        ?.map((s) => Number(s.duration))
        .find((d) => Number.isFinite(d) && d > 0);

      resolve(streamDur ?? 0);
    });
  });

const transcodeAudio = (input: string, output: string): Promise<void> =>
  new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioCodec('libopus')
      .audioBitrate('32k') // voice — 32k is enough
      .audioChannels(1) // mono for voice
      .audioFrequency(16000) // 16kHz for voice
      .format('ogg')
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });

export const audioHandler = async (
  payload: JobPayload,
): Promise<ProcessResult> => {
  const tmpBase = join(tmpdir(), payload.uploadId);
  const tmpInput = join(tmpBase, 'input');
  const tmpOutput = join(tmpBase, 'output.ogg');

  await mkdir(tmpBase, { recursive: true });

  try {
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

    await transcodeAudio(tmpInput, tmpOutput);
    // raw MediaRecorder webm has no reliable duration in its container
    // (confirmed: ffprobe returns it for neither streams nor format on
    // such files) — read it from the finalized .ogg output instead.
    const duration = await getDuration(tmpOutput);

    const baseKey = `${payload.context}/${payload.userId}/${payload.uploadId}`;
    const finalKey = `${baseKey}/audio.ogg`;

    await s3App.send(
      new PutObjectCommand({
        Bucket: config.s3PrivateBucket,
        Key: finalKey,
        Body: await readFile(tmpOutput),
        ContentType: 'audio/ogg',
      }),
    );

    const variants = {
      original: `${config.s3Url}/${config.s3PrivateBucket}/${finalKey}`,
    };

    return {
      variants,
      duration,
      finalBucket: config.s3PrivateBucket,
      finalKey,
    };
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
};
