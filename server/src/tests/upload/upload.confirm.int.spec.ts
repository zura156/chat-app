import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { describeIntegration, resetDatabase } from '../env';
import { Upload } from '../../upload/upload.model';
import type { AuthRequest } from '../../auth/middlewares/auth.middleware';

/*
 * POST /upload/confirm freezes a dm-file (SECURITY-FIXES.md 2.2): the bytes the
 * client PUT are copied to `frozen/<uploadId>/…`, where no presigned URL
 * reaches, and the job, the record and every later step use that key. The
 * presigned PUT stays valid after confirm, so the original key can't be
 * trusted to hold the bytes ClamAV scanned.
 *
 * Mongo is real, because the claim that lets only one confirm through is a
 * single conditional write. Storage is a map that answers as SeaweedFS 4.13
 * did when measured: HEAD of a missing key 404, a copy from one 400.
 */

// Hoisted with the mock that uses it; `vi.mock` runs before the module body.
const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../../config/queue', () => ({ uploadQueue: { add } }));

const stored = new Map<string, string>();
const sent: unknown[] = [];
let headStatus: number | undefined; // a forced HEAD answer, as in production's quirk

const storageError = (status: number, name: string) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

vi.mock('../../config/s3', () => ({
  s3App: {
    send: async (command: unknown) => {
      sent.push(command);
      // Let a second confirm run in between, as two requests would.
      await new Promise((resolve) => setImmediate(resolve));
      if (command instanceof HeadObjectCommand) {
        if (headStatus) throw storageError(headStatus, 'Forbidden');
        if (!stored.has(command.input.Key!)) throw storageError(404, 'NotFound');
        return {};
      }
      if (command instanceof CopyObjectCommand) {
        const source = command.input.CopySource!.replace(/^uploads-temp\//, '');
        if (!stored.has(source)) throw storageError(400, 'InvalidArgument');
        stored.set(command.input.Key!, stored.get(source)!);
        return {};
      }
      if (command instanceof DeleteObjectCommand) {
        stored.delete(command.input.Key!);
        return {};
      }
      throw new Error('unexpected command');
    },
  },
}));

vi.mock('../../config/config', async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return {
    default: { ...actual.default, s3TempBucket: 'uploads-temp' },
  };
});

// Static, after the mocks: vitest hoists `vi.mock` above the imports.
import { confirm } from '../../upload/upload.controller';

const owner = new Types.ObjectId();

const ask = async (uploadId: string, userId: Types.ObjectId = owner) => {
  const res = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  await confirm(
    { body: { uploadId }, user: { _id: userId } } as unknown as AuthRequest,
    res as unknown as Response,
  );
  return res;
};

const makeUpload = async (context: string, extension: string) => {
  const id = randomUUID();
  const fileKey = `${context}/${owner}/${id}/original.${extension}`;
  await Upload.create({
    _id: id,
    userId: owner,
    context,
    fileKey,
    mimeType: 'text/plain',
    fileSize: 5,
    status: 'pending',
  });
  return { id, fileKey };
};

const of = <T>(type: new (...args: never[]) => T) =>
  sent.filter((c): c is T => c instanceof type);

describeIntegration('confirm', () => {
  beforeEach(async () => {
    await resetDatabase();
    stored.clear();
    sent.length = 0;
    headStatus = undefined;
    add.mockReset();
  });
  afterEach(resetDatabase);

  it('freezes a dm-file where no presigned URL reaches, and queues that key', async () => {
    const { id, fileKey } = await makeUpload('dm-file', 'txt');
    stored.set(fileKey, 'A');

    const res = await ask(id);

    const frozen = `frozen/${id}/original.txt`;
    expect(res.body).toEqual({ ok: true });
    expect([...stored]).toEqual([[frozen, 'A']]); // and the original is gone
    expect(await Upload.findById(id).lean()).toMatchObject({
      status: 'processing',
      fileKey: frozen,
    });
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0][1]).toMatchObject({ uploadId: id, fileKey: frozen });
  });

  it('keeps the bytes it froze when the presigned URL is used again', async () => {
    const { id, fileKey } = await makeUpload('dm-file', 'txt');
    stored.set(fileKey, 'A');
    await ask(id);

    stored.set(fileKey, 'B'); // the same presigned PUT, after confirm

    expect(stored.get(`frozen/${id}/original.txt`)).toBe('A');
  });

  it('lets one of two confirms at once through: one copy, one job', async () => {
    const { id, fileKey } = await makeUpload('dm-file', 'txt');
    stored.set(fileKey, 'A');

    const answers = await Promise.all([ask(id), ask(id)]);

    expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    expect(of(CopyObjectCommand)).toHaveLength(1);
    expect(add).toHaveBeenCalledOnce();
  });

  it('refuses a dm-file not uploaded yet, and lets it confirm once it is', async () => {
    const { id, fileKey } = await makeUpload('dm-file', 'txt');

    const early = await ask(id);
    expect(early.statusCode).toBe(400);
    expect(early.body.message).toBe('File not found in storage. Upload it first.');
    expect(of(CopyObjectCommand)).toHaveLength(0);
    expect((await Upload.findById(id).lean())?.status).toBe('pending');

    stored.set(fileKey, 'A');
    expect((await ask(id)).body).toEqual({ ok: true });
    expect(add).toHaveBeenCalledOnce();
  });

  it('puts the upload back to pending when the copy fails', async () => {
    const { id, fileKey } = await makeUpload('dm-file', 'txt');
    stored.set(fileKey, 'A');
    headStatus = 403; // exists, as production's HEAD can say
    stored.delete(fileKey); // but the copy then finds nothing

    const res = await ask(id);

    expect(res.statusCode).toBe(500);
    expect(await Upload.findById(id).lean()).toMatchObject({
      status: 'pending',
      fileKey,
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('only checks that other contexts exist, as before, 403 included', async () => {
    const { id, fileKey } = await makeUpload('dm-image', 'jpg');
    headStatus = 403;

    expect((await ask(id)).body).toEqual({ ok: true });
    expect(of(CopyObjectCommand)).toHaveLength(0);
    expect(add.mock.calls[0][1]).toMatchObject({ fileKey });
  });

  it("answers someone else's upload as missing, and a confirmed one as confirmed", async () => {
    const { id, fileKey } = await makeUpload('dm-file', 'txt');
    stored.set(fileKey, 'A');

    expect((await ask(id, new Types.ObjectId())).statusCode).toBe(404);
    await ask(id);
    const again = await ask(id);
    expect(again.statusCode).toBe(400);
    expect(again.body.message).toBe('Upload already confirmed');
  });
});
