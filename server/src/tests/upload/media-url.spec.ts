import { describe, expect, it, vi } from 'vitest';

/*
 * A dm-file's signed URL carries the headers it must be served with
 * (SECURITY-FIXES.md 2.3c), so a file stored before 2.3c, under the type its
 * client sent, still arrives as its own type and as a download. Signing is
 * local, so this needs no storage; that SeaweedFS honours the two parameters
 * was checked against SeaweedFS 4.13.
 */

vi.mock('../../config/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config')>();
  return {
    default: {
      ...actual.default,
      s3Url: 'http://s3.test',
      s3PrivateBucket: 'media-private',
      s3AccessKey: 'test-access',
      s3SecretKey: 'test-secret',
    },
  };
});

import {
  signAttachments,
  signPrivateUrl,
} from '../../upload/media-url.service';

const sign = async (key: string) =>
  new URL(await signPrivateUrl(`http://s3.test/media-private/${key}`));

describe('signPrivateUrl', () => {
  it('signs a dm-file with its type and as a download', async () => {
    const url = await sign('dm-file/u/id/original.txt');

    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.get('response-content-type')).toBe(
      'text/plain; charset=utf-8',
    );
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="file.txt"',
    );
  });

  it('signs an image without them, so it still shows inline', async () => {
    const url = await sign('dm-image/u/id/original.webp');

    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.has('response-content-type')).toBe(false);
    expect(url.searchParams.has('response-content-disposition')).toBe(false);
  });

  it("names a message's file by its sender's name, with the server's extension", async () => {
    const [attachment] = await signAttachments([
      {
        originalName: 'Q3 report.js',
        variants: { original: 'http://s3.test/media-private/dm-file/u/id/original.txt' },
      },
    ]);
    const url = new URL(attachment.variants!.original as string);

    expect(url.searchParams.get('response-content-disposition')).toBe(
      "attachment; filename=\"file.txt\"; filename*=UTF-8''Q3%20report.txt",
    );
  });

  it('still gives everyone the same URL within the hour', async () => {
    const key = 'dm-file/u/id/original.pdf';
    expect((await sign(key)).href).toBe((await sign(key)).href);
  });
});
