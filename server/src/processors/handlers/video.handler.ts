import ffmpeg from 'fluent-ffmpeg';
import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3App } from '../../utils/s3';
import { HLS_BUCKET } from '../../config/upload.config';

const RENDITIONS = [
  {
    name: '360p',
    width: 640,
    height: 360,
    bitrate: '800k',
    audioBitrate: '96k',
  },
  {
    name: '720p',
    width: 1280,
    height: 720,
    bitrate: '2800k',
    audioBitrate: '128k',
  },
  {
    name: '1080p',
    width: 1920,
    height: 1080,
    bitrate: '5000k',
    audioBitrate: '192k',
  },
];

export async function processVideo(
  localPath: string,
  hlsPrefix: string, // e.g. hls/{userId}/{fileId}
): Promise<string> {
  // returns master playlist key
  const tmpDir = `${localPath}_hls`;
  await fs.mkdir(tmpDir, { recursive: true });

  // Transcode all renditions
  await Promise.all(
    RENDITIONS.map((r) => transcodeRendition(localPath, tmpDir, r)),
  );

  // Build master playlist
  const masterContent = buildMasterPlaylist();
  const masterPath = path.join(tmpDir, 'master.m3u8');
  await fs.writeFile(masterPath, masterContent);

  // Upload all HLS files to S3
  await uploadHLSDirectory(tmpDir, hlsPrefix);

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });

  return `${hlsPrefix}/master.m3u8`;
}

function transcodeRendition(
  inputPath: string,
  outDir: string,
  rendition: (typeof RENDITIONS)[0],
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        `-vf scale=${rendition.width}:${rendition.height}:force_original_aspect_ratio=decrease,pad=${rendition.width}:${rendition.height}:(ow-iw)/2:(oh-ih)/2`,
        `-c:v libx264`,
        `-b:v ${rendition.bitrate}`,
        `-c:a aac`,
        `-b:a ${rendition.audioBitrate}`,
        `-f hls`,
        `-hls_time 6`,
        `-hls_list_size 0`,
        `-hls_playlist_type vod`,
        `-hls_segment_filename ${outDir}/${rendition.name}_%03d.ts`,
      ])
      .output(`${outDir}/${rendition.name}.m3u8`)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

function buildMasterPlaylist(): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  const bandwidths: Record<string, number> = {
    '360p': 800000,
    '720p': 2800000,
    '1080p': 5000000,
  };
  const resolutions: Record<string, string> = {
    '360p': '640x360',
    '720p': '1280x720',
    '1080p': '1920x1080',
  };

  for (const r of RENDITIONS) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidths[r.name]},RESOLUTION=${resolutions[r.name]}`,
    );
    lines.push(`${r.name}.m3u8`);
  }
  return lines.join('\n');
}

async function uploadHLSDirectory(
  localDir: string,
  s3Prefix: string,
): Promise<void> {
  const files = await fs.readdir(localDir);
  await Promise.all(
    files.map(async (file) => {
      const contentType = file.endsWith('.m3u8')
        ? 'application/vnd.apple.mpegurl'
        : 'video/MP2T';

      await s3App.send(
        new PutObjectCommand({
          Bucket: HLS_BUCKET,
          Key: `${s3Prefix}/${file}`,
          Body: createReadStream(path.join(localDir, file)),
          ContentType: contentType,
        }),
      );
    }),
  );
}
