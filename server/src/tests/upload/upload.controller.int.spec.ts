import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeIntegration, resetDatabase } from '../env';
import { Upload, type UploadStatus } from '../../upload/upload.model';
import type { AuthRequest } from '../../auth/middlewares/auth.middleware';

/*
 * GET /upload/:uploadId/status — where an upload is in processing, for its
 * owner and nobody else.
 *
 * It exists for sentinel's upload canary (Z, ADR 0031), which uploads a clean
 * file and the EICAR test string as its own account every ten minutes and has
 * to learn whether ClamAV passed one and caught the other. The upload is never
 * attached to a message, so neither the websocket events nor
 * /upload/signed-url (which needs a message) can tell it.
 *
 * The status of someone else's upload is information about them — a file was
 * flagged as malware — so another user's id is answered exactly as an id that
 * does not exist.
 */

// The queue connects to Redis at import and the S3 client is configured from
// whatever server/.env holds; neither is part of this.
vi.mock('../../config/queue', () => ({ uploadQueue: { add: vi.fn() } }));
vi.mock('../../config/s3', () => ({
  s3App: { send: vi.fn() },
  s3Quarantine: { send: vi.fn() },
}));

// Static, after the mocks: vitest hoists `vi.mock` above the imports.
import { getUploadStatus } from '../../upload/upload.controller';

interface MockResponse {
  statusCode?: number;
  body?: any;
}

const mockResponse = (): MockResponse & Response => {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as MockResponse & Response;
};

const ask = async (uploadId: string, userId?: Types.ObjectId) => {
  const req = {
    params: { uploadId },
    user: userId ? { _id: userId } : undefined,
  } as unknown as AuthRequest;
  const res = mockResponse();
  await getUploadStatus(req, res);
  return res;
};

describeIntegration('getUploadStatus', () => {
  const owner = new Types.ObjectId();
  const stranger = new Types.ObjectId();

  const makeUpload = async (status: UploadStatus) => {
    const id = randomUUID();
    await Upload.create({
      _id: id,
      userId: owner,
      context: 'dm-file',
      fileKey: `dm-file/${owner}/${id}/original.txt`,
      mimeType: 'text/plain',
      fileSize: 59,
      status,
    });
    return id;
  };

  beforeEach(resetDatabase);
  afterEach(resetDatabase);

  it('tells the owner where their upload is, as it changes', async () => {
    const id = await makeUpload('processing');

    const first = await ask(id, owner);
    expect(first.statusCode).toBeUndefined(); // 200
    expect(first.body).toEqual({ status: 'processing' });

    await Upload.updateOne({ _id: id }, { status: 'infected' });
    expect((await ask(id, owner)).body).toEqual({ status: 'infected' });
  });

  it('answers the status and nothing else', async () => {
    const id = await makeUpload('ready');
    await Upload.updateOne(
      { _id: id },
      { variants: { original: 'https://s3.test/media-private/k' } },
    );

    expect(Object.keys((await ask(id, owner)).body)).toEqual(['status']);
  });

  it("answers another user's upload exactly as one that does not exist", async () => {
    const id = await makeUpload('infected');

    const theirs = await ask(id, stranger);
    const missing = await ask(randomUUID(), stranger);

    expect(theirs.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(theirs.body).toEqual(missing.body);
  });

  it('refuses an id that is not a UUID', async () => {
    const res = await ask('../../signed-url', owner);
    expect(res.statusCode).toBe(400);
  });

  it('refuses a request with no user', async () => {
    const id = await makeUpload('ready');
    expect((await ask(id)).statusCode).toBe(401);
  });
});
