import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

interface CompressOptions {
  maxDimension?: number; // For images/videos
  quality?: number; // 1-100
  outputFormat?: 'auto' | 'webp' | 'jpeg' | 'mp4' | 'original';
}

export async function compressMedia(
  inputBuffer: Buffer,
  mimeType: string,
  options: CompressOptions = {},
): Promise<Buffer> {
  const { maxDimension = 1920, quality = 80, outputFormat = 'auto' } = options;

  // Images
  if (mimeType.startsWith('image/')) {
    let processor = sharp(inputBuffer).resize(maxDimension, maxDimension, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    // Choose format
    const format = outputFormat === 'auto' ? 'webp' : outputFormat;

    switch (format) {
      case 'webp':
        return processor.webp({ quality, effort: 6 }).toBuffer();
      case 'jpeg':
        return processor.jpeg({ quality, mozjpeg: true }).toBuffer();
      default:
        return processor.toBuffer();
    }
  }

  // Videos
  if (mimeType.startsWith('video/')) {
    return compressVideo(inputBuffer, maxDimension, quality);
  }

  // Audio
  if (mimeType.startsWith('audio/')) {
    return compressAudio(inputBuffer, quality);
  }

  // PDF
  if (mimeType === 'application/pdf') {
    return compressPDF(inputBuffer, quality);
  }

  // No compression for other types
  return inputBuffer;
}

async function compressVideo(
  buffer: Buffer,
  maxDimension: number,
  quality: number,
): Promise<Buffer> {
  const tempInput = `/tmp/input-${Date.now()}.mp4`;
  const tempOutput = `/tmp/output-${Date.now()}.mp4`;

  await fs.writeFile(tempInput, buffer);

  return new Promise((resolve, reject) => {
    const crf = Math.round(51 - (quality / 100) * 33); // quality 80 → crf 28

    ffmpeg(tempInput)
      .size(`${maxDimension}x?`)
      .outputOptions([
        `-crf ${crf}`,
        '-preset fast',
        '-c:v libx264',
        '-c:a aac',
        '-b:a 96k',
        '-movflags +faststart',
      ])
      .on('end', async () => {
        const output = await fs.readFile(tempOutput);
        await fs.unlink(tempInput);
        await fs.unlink(tempOutput);
        resolve(output);
      })
      .on('error', reject)
      .save(tempOutput);
  });
}

async function compressAudio(buffer: Buffer, quality: number): Promise<Buffer> {
  const tempInput = `/tmp/input-${Date.now()}.audio`;
  const tempOutput = `/tmp/output-${Date.now()}.mp3`;

  await fs.writeFile(tempInput, buffer);

  return new Promise((resolve, reject) => {
    const bitrate = Math.round((quality / 100) * 320); // quality 80 → 256k

    ffmpeg(tempInput)
      .audioBitrate(`${bitrate}k`)
      .audioCodec('libmp3lame')
      .on('end', async () => {
        const output = await fs.readFile(tempOutput);
        await fs.unlink(tempInput);
        await fs.unlink(tempOutput);
        resolve(output);
      })
      .on('error', reject)
      .save(tempOutput);
  });
}

async function compressPDF(buffer: Buffer, quality: number): Promise<Buffer> {
  const tempInput = `/tmp/input-${Date.now()}.pdf`;
  const tempOutput = `/tmp/output-${Date.now()}.pdf`;

  await fs.writeFile(tempInput, buffer);

  const settings =
    quality > 80 ? '/printer' : quality > 50 ? '/ebook' : '/screen';

  await execAsync(`gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 \
    -dPDFSETTINGS=${settings} -dNOPAUSE -dQUIET -dBATCH \
    -sOutputFile=${tempOutput} ${tempInput}`);

  const output = await fs.readFile(tempOutput);
  await fs.unlink(tempInput);
  await fs.unlink(tempOutput);

  return output;
}
