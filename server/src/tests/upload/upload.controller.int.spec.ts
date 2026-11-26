import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeIntegration, resetDatabase } from '../env';
import { Upload, type UploadStatus } from '../../upload/upload.model';
import { Conversation } from '../../messenger/models/conversation.model';
import { CONTEXT_CONFIG } from '../../config/upload.config';
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

// The queue connects to Redis at import, and server/.env's storage settings are
// a live endpoint and live keys. Presigning is local (nothing is sent), so
// throwaway values stand in for them.
vi.mock('../../config/queue', () => ({ uploadQueue: { add: vi.fn() } }));
vi.mock('../../config/config', async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return {
    default: {
      ...actual.default,
      s3Url: 'https://s3.test',
      s3AccessKey: 'test-access',
      s3SecretKey: 'test-secret',
      s3QuarantineAccessKey: 'test-access',
      s3QuarantineSecretKey: 'test-secret',
      s3PublicBucket: 'media-public',
      s3PrivateBucket: 'media-private',
      s3QuarantineBucket: 'media-quarantine',
      s3TempBucket: 'uploads-temp',
    },
  };
});

// Static, after the mocks: vitest hoists `vi.mock` above the imports.
import { getUploadStatus, presign } from '../../upload/upload.controller';

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

/*
 * POST /upload/presign — what the signature covers.
 *
 * Whoever PUTs to a presigned URL must send every header it signed, byte for
 * byte. `1995e39` gave dm-file presigns a Content-Disposition, and the SDK
 * signs it (`X-Amz-SignedHeaders=content-disposition;content-length;host`).
 * The app's client PUTs with Content-Type alone, so SeaweedFS answered every DM
 * file upload with SignatureDoesNotMatch (found by Z's upload canary against
 * SeaweedFS 4.13 on 22 Nov). The browser sends Host and Content-Length itself
 * and the client sets Content-Type: a signature may cover nothing else.
 *
 * And it must cover Content-Type (SECURITY-FIXES.md 2.4): the presigner leaves
 * it out by default, so the type declared at presign bound nothing, and a PUT
 * could store the object under any type it liked.
 */
const CLIENT_SENDS = ['content-length', 'content-type', 'host'];

describeIntegration('presign', () => {
  const owner = new Types.ObjectId();

  beforeEach(resetDatabase);
  afterEach(resetDatabase);

  it('signs only headers the client sends, in every context', async () => {
    const group = await Conversation.create({
      participants: [owner, new Types.ObjectId()],
      is_group: true,
      group_name: 'Signed headers',
      created_by: owner,
    });

    for (const [context, { allowedMimes }] of Object.entries(CONTEXT_CONFIG)) {
      const req = {
        body: {
          context,
          mimeType: allowedMimes[0],
          fileSize: 1,
          ...(context === 'group-avatar' ? { resourceId: String(group._id) } : {}),
        },
        user: { _id: owner },
      } as unknown as AuthRequest;
      const res = mockResponse();
      await presign(req, res);

      expect(res.statusCode, `${context}: ${JSON.stringify(res.body)}`).toBeUndefined();
      const signed = new URL(res.body.presignedUrl).searchParams
        .get('X-Amz-SignedHeaders')!
        .split(';');
      expect(signed.filter((h) => !CLIENT_SENDS.includes(h)), context).toEqual([]);
      expect(signed, context).toContain('content-type');
    }
  });
});
