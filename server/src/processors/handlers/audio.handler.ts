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
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const getDuration = async (filePath: string): Promise<number> => {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_streams',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  return parseFloat(data.streams[0]?.duration ?? '0');
};

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

    await s3App.send(
      new DeleteObjectCommand({
        Bucket: config.s3TempBucket,
        Key: payload.fileKey,
      }),
    );

    const variants = {
      original: `${config.s3Url}/${config.s3PrivateBucket}/${finalKey}`,
    };

    return { variants, duration, finalBucket: config.s3PrivateBucket, finalKey };
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
};
