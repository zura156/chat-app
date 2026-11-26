import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * A group picture a client sends is stored and then rendered by every member,
 * so only the public bucket's own URLs may be stored (SECURITY-FIXES.md 2.5).
 * The rejected rows are the ways a string can start like one of ours and still
 * load from somewhere else, or be read differently by the browser than it
 * reads here.
 */

vi.mock('../../config/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config')>();
  return {
    default: {
      ...actual.default,
      s3Url: 'https://s3.example.test',
      s3PublicBucket: 'media-public',
      s3PrivateBucket: 'media-private',
      s3TempBucket: 'uploads-temp',
    },
  };
});

import config from '../../config/config';
import { isOwnMediaUrl } from '../../upload/own-media-url';

const S3 = 'https://s3.example.test';
const KEY =
  'group-avatar/0123456789abcdef01234567/1b4e28ba-2fa1-11d2-883f-0016d3cca427';

// Built the way the image handler builds it (image.handler.ts).
const variant = (name: string) =>
  `${config.s3Url}/${config.s3PublicBucket}/${KEY}/${name}.webp`;

describe('isOwnMediaUrl', () => {
  const { s3Url, s3PublicBucket } = config;
  afterEach(() => {
    Object.assign(config, { s3Url, s3PublicBucket });
  });

  it.each(['thumb', 'medium', 'large'])(
    'accepts the %s variant a group-avatar upload stores',
    (name) => {
      expect(isOwnMediaUrl(variant(name))).toBe(true);
    },
  );

  it.each([
    ['protocol-relative', '//evil.example/a.png'],
    ['a backslash browsers read as protocol-relative', '/\\evil.example/a.png'],
    ['a relative path', '/media-public/a.png'],
    [
      'a look-alike host',
      `https://s3.example.test.evil.example/media-public/${KEY}/medium.webp`,
    ],
    [
      'another port',
      `https://s3.example.test:8443/media-public/${KEY}/medium.webp`,
    ],
    ['plain http', `http://s3.example.test/media-public/${KEY}/medium.webp`],
    [
      'user info',
      `https://user:pass@s3.example.test/media-public/${KEY}/medium.webp`,
    ],
    ['the temp bucket, unscanned', `${S3}/uploads-temp/${KEY}/original.png`],
    ['the private bucket', `${S3}/media-private/dm-image/u/id/original.webp`],
    ['a bucket the public one prefixes', `${S3}/media-public-x/a.png`],
    ['the bucket root', `${S3}/media-public/`],
    [
      'dot segments into another bucket',
      `${S3}/media-public/../uploads-temp/a.png`,
    ],
    ['encoded dot segments', `${S3}/media-public/%2e%2e/uploads-temp/a.png`],
    [
      'upper-case encoded dot segments',
      `${S3}/media-public/%2E%2E/uploads-temp/a.png`,
    ],
    [
      'an encoded slash after dot-dot',
      `${S3}/media-public/..%2fuploads-temp/a.png`,
    ],
    [
      'an encoded slash after encoded dot-dot',
      `${S3}/media-public/%2e%2e%2Fuploads-temp/a.png`,
    ],
    ['encoded backslashes', `${S3}/media-public/a%5c..%5cuploads-temp/a.png`],
    ['a backslash the parser turns into a slash', `${S3}\\media-public/a.png`],
    ['a newline the parser strips', `${S3}/media-public/a\n.png`],
    ['a tab the parser strips', `${S3}/media\t-public/a.png`],
    [
      'an upper-case host',
      `https://S3.EXAMPLE.TEST/media-public/${KEY}/medium.webp`,
    ],
    ['a query', `${variant('medium')}?x=1`],
    ['a bare question mark', `${variant('medium')}?`],
    ['a fragment', `${variant('medium')}#x`],
    ['a bare hash', `${variant('medium')}#`],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:image/svg+xml,<svg onload=alert(1)>'],
    ['an empty string', ''],
  ])('rejects %s', (_, value) => {
    expect(isOwnMediaUrl(value)).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { toString: () => variant('medium') }],
    ['an array', [variant('medium')]],
  ])('rejects %s', (_, value) => {
    expect(isOwnMediaUrl(value)).toBe(false);
  });

  it('accepts nothing while the endpoint or the bucket is unset', () => {
    const url = variant('medium');

    Object.assign(config, { s3PublicBucket: '' });
    expect(isOwnMediaUrl(url)).toBe(false);
    expect(isOwnMediaUrl(`${S3}//${KEY}/medium.webp`)).toBe(false);

    Object.assign(config, { s3Url: '', s3PublicBucket });
    expect(isOwnMediaUrl(url)).toBe(false);
    expect(isOwnMediaUrl(`/media-public/${KEY}/medium.webp`)).toBe(false);
  });
});
