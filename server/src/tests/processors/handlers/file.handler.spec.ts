import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../../../config/config';
import { JobPayload } from '../../../processors/handlers/types';

/*
 * What the dm-file handler stores, and what it refuses (SECURITY-FIXES.md 2.3b,
 * 2.3c). The stored object's headers are the point: the old copy kept the
 * Content-Type the client's PUT sent, so HTML declared as text/plain was served
 * as text/html. Storage and the Upload model are stubbed. Against SeaweedFS
 * 4.13, a REPLACE copy kept the source's Content-Type and set no disposition,
 * and a PUT set both, which is why the handler re-uploads.
 */

let head: Uint8Array;
const whole = { stream: 'the temp object' };
const sent: unknown[] = [];
vi.mock('../../../config/s3', () => ({
  s3App: {
    send: async (command: unknown) => {
      sent.push(command);
      if (command instanceof GetObjectCommand) {
        // A ranged read is the signature check's; a whole one is the store's.
        return command.input.Range
          ? { Body: { transformToByteArray: async () => head } }
          : { Body: whole, ContentLength: 1234 };
      }
      return {};
    },
  },
}));

let record: { mimeType: string } | null;
vi.mock('../../../upload/upload.model', () => ({
  Upload: { findById: () => ({ lean: async () => record }) },
}));

import { fileHandler } from '../../../processors/handlers/file.handler';

const payload = (over: Partial<JobPayload> = {}): JobPayload => ({
  uploadId: 'a1b2c3d4-0000-4000-8000-000000000001',
  userId: '6740c0ffee00000000000001',
  context: 'dm-file',
  resourceId: null,
  fileKey: 'dm-file/6740c0ffee00000000000001/a1b2c3d4/original.txt',
  mimeType: 'text/plain',
  ...over,
});

const ascii = (s: string) => new TextEncoder().encode(s);
const of = <T>(type: new (...args: never[]) => T) =>
  sent.filter((c): c is T => c instanceof type);

describe('fileHandler', () => {
  beforeEach(() => {
    sent.length = 0;
    record = { mimeType: 'text/plain' };
    head = ascii('hello\n');
  });

  it('stores text with its type, a UTF-8 charset and a download disposition', async () => {
    await fileHandler(payload());

    const [put] = of(PutObjectCommand);
    expect(put.input).toEqual({
      Bucket: config.s3PrivateBucket,
      Key: 'dm-file/6740c0ffee00000000000001/a1b2c3d4-0000-4000-8000-000000000001/original.txt',
      Body: whole,
      ContentLength: 1234,
      ContentType: 'text/plain; charset=utf-8',
      ContentDisposition: 'attachment; filename="file.txt"',
    });
    expect(of(DeleteObjectCommand)).toHaveLength(1);
  });

  it('stores a PDF with its own type and no charset', async () => {
    record = { mimeType: 'application/pdf' };
    head = ascii('%PDF-1.7\n');
    await fileHandler(
      payload({ fileKey: 'dm-file/u/id/original.pdf', mimeType: 'application/pdf' }),
    );

    const [put] = of(PutObjectCommand);
    expect(put.input.ContentType).toBe('application/pdf');
    expect(put.input.ContentDisposition).toBe('attachment; filename="file.pdf"');
  });

  it('takes the type from the upload record, not the job', async () => {
    await fileHandler(payload({ mimeType: 'text/html' }));
    expect(of(PutObjectCommand)[0].input.ContentType).toBe(
      'text/plain; charset=utf-8',
    );
  });

  it('checks the first 4 KiB before it reads the whole temp object', async () => {
    await fileHandler(payload());
    const [check, store] = of(GetObjectCommand);
    expect(check.input).toEqual({
      Bucket: config.s3TempBucket,
      Key: payload().fileKey,
      Range: 'bytes=0-4095',
    });
    expect(store.input).toEqual({
      Bucket: config.s3TempBucket,
      Key: payload().fileKey,
    });
  });

  it('refuses for good bytes that do not fit the type, and stores nothing', async () => {
    record = { mimeType: 'application/pdf' };
    head = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]); // a ZIP
    const run = fileHandler(payload({ fileKey: 'dm-file/u/id/original.pdf' }));

    await expect(run).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(run).rejects.toThrow('File content does not match application/pdf');
    expect(of(GetObjectCommand)).toHaveLength(1);
    expect(of(PutObjectCommand)).toHaveLength(0);
    expect(of(DeleteObjectCommand)).toHaveLength(0);
  });

  it('refuses for good a record whose type is no longer accepted', async () => {
    record = { mimeType: 'text/html' };
    const run = fileHandler(payload());

    await expect(run).rejects.toBeInstanceOf(UnrecoverableError);
    expect(sent).toHaveLength(0);
  });

  it('refuses for good when the record is gone', async () => {
    record = null;
    await expect(fileHandler(payload())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(sent).toHaveLength(0);
  });
});
