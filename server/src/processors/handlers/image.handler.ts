import sharp from 'sharp';
import { UploadContext } from '../../config/upload.config';
import { uploadBufferToApp } from '../../upload/s3-transfer.service';

// Resize config per context
const IMAGE_PROFILES: Record<
  string,
  { width: number; height: number; fit: keyof sharp.FitEnum }
> = {
  avatar: { width: 256, height: 256, fit: 'cover' },
  'group-avatar': { width: 256, height: 256, fit: 'cover' },
  'cover-photo': { width: 1500, height: 500, fit: 'cover' },
  'dm-image': { width: 1920, height: 1920, fit: 'inside' },
  'post-image': { width: 1920, height: 1920, fit: 'inside' },
  story: { width: 1080, height: 1920, fit: 'inside' },
};

export async function processImage(
  localPath: string,
  destKey: string,
  context: UploadContext,
): Promise<void> {
  const profile = IMAGE_PROFILES[context] ?? IMAGE_PROFILES['dm-image'];

  const buffer = await sharp(localPath)
    .resize(profile.width, profile.height, {
      fit: profile.fit,
      withoutEnlargement: true,
    })
    .webp({ quality: 82 }) // convert everything to webp for consistent delivery
    .toBuffer();

  const webpKey = destKey.replace(/\.[^/.]+$/, '.webp');
  await uploadBufferToApp(buffer, webpKey, 'image/webp');
}
