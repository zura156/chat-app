import { randomUUID } from 'crypto';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { Types } from 'mongoose';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeIntegration, resetDatabase } from '../env';
import { Upload, type UploadStatus } from '../../upload/upload.model';

/*
 * The worker's hourly sweep of the upload canary's files (Z, ADR 0031).
 *
 * Sentinel uploads a clean file and the EICAR test string as its own account
 * every ten minutes. Nothing else would ever remove them: a clean `dm-file`
 * that is ready is exempt from the TTL reaper, and an infected one leaves its
 * object in the quarantine bucket, which nothing deletes. So the worker sweeps
 * that one account's finished uploads once they are an hour old.
 *
 * The sweep deletes whatever its filter matches, so most of these are about
 * what it must leave alone: other people's uploads, the canary's own uploads
 * still being scanned, and the infected record whose quarantine object could
 * not be removed (its record is the only way to find that object again).
 *
 * Both S3 clients are stubbed and kept apart, because which credentials delete
 * the quarantine object is part of the behaviour: `moveToQuarantine` writes it
 * with the `quarantine-writer` identity, not the app's.
 */

const appSend = vi.fn(async (_command: unknown): Promise<unknown> => ({}));
const quarantineSend = vi.fn(
  async (_command: unknown): Promise<unknown> => ({}),
);
vi.mock('../../config/s3', () => ({
  s3App: { send: (command: unknown) => appSend(command) },
  s3Quarantine: { send: (command: unknown) => quarantineSend(command) },
}));

// Bucket names from server/.env would make the assertions machine-dependent.
vi.mock('../../config/config', async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return {
    default: {
      ...actual.default,
      s3Url: 'https://s3.test',
      s3PublicBucket: 'media-public',
      s3PrivateBucket: 'media-private',
      s3TempBucket: 'uploads-temp',
      s3QuarantineBucket: 'media-quarantine',
    },
  };
});

import { sweepCanaryUploads } from '../../upload/canary-sweep.service';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-22T12:00:00Z');

/** Every DeleteObjects a client was sent, as bucket and keys. */
const deletes = (send: typeof appSend) =>
  send.mock.calls
    .map(([command]) => command)
    .filter((c): c is DeleteObjectsCommand => c instanceof DeleteObjectsCommand)
    .map((c) => ({
      bucket: c.input.Bucket,
      keys: (c.input.Delete?.Objects ?? []).map((o) => o.Key),
    }));

const exists = async (id: string) => (await Upload.countDocuments({ _id: id })) === 1;

describeIntegration('sweepCanaryUploads', () => {
  const canary = new Types.ObjectId();
  const someone = new Types.ObjectId();

  const makeUpload = async (
    userId: Types.ObjectId,
    status: UploadStatus,
    ageMs: number,
  ) => {
    const id = randomUUID();
    const fileKey = `dm-file/${userId}/${id}/original.txt`;
    await Upload.create({
      _id: id,
      userId,
      context: 'dm-file',
      fileKey,
      mimeType: 'text/plain',
      fileSize: 59,
      status,
      variants:
        status === 'ready'
          ? { original: `https://s3.test/media-private/${fileKey}` }
          : null,
    });
    // Around Mongoose: its timestamps would stamp createdAt as now.
    await Upload.collection.updateOne(
      { _id: id as never },
      { $set: { createdAt: new Date(NOW.getTime() - ageMs) } },
    );
    return id;
  };

  beforeEach(async () => {
    await resetDatabase();
    appSend.mockReset().mockImplementation(async () => ({}));
    quarantineSend.mockReset().mockImplementation(async () => ({}));
  });
  afterEach(resetDatabase);

  it("removes the canary's finished uploads once they are an hour old, objects first", async () => {
    const ready = await makeUpload(canary, 'ready', 2 * HOUR);
    const failed = await makeUpload(canary, 'failed', 2 * HOUR);
    const infected = await makeUpload(canary, 'infected', 2 * HOUR);

    expect(await sweepCanaryUploads(canary.toString(), NOW)).toBe(3);

    for (const id of [ready, failed, infected]) expect(await exists(id)).toBe(false);

    // The quarantine copy, by the key moveToQuarantine wrote it under, with the
    // quarantine-writer's credentials.
    expect(deletes(quarantineSend)).toEqual([
      { bucket: 'media-quarantine', keys: [`quarantine/${infected}/original.txt`] },
    ]);
    // The clean file's stored object, through purgeUploads, with the app's.
    const app = deletes(appSend);
    expect(app.find((d) => d.bucket === 'media-private')?.keys).toEqual([
      `dm-file/${canary}/${ready}/original.txt`,
    ]);
    expect(app.some((d) => d.bucket === 'media-quarantine')).toBe(false);
  });

  it("leaves other people's uploads, unfinished ones and young ones alone", async () => {
    const kept = [
      await makeUpload(someone, 'ready', 2 * HOUR),
      await makeUpload(someone, 'infected', 2 * HOUR),
      await makeUpload(someone, 'failed', 2 * HOUR),
      // A worker outage leaves the backlog `processing` for over an hour. Swept,
      // an EICAR among it would still reach quarantine with no record left to
      // find it by. The 24 h TTL on unfinished records reaps these instead.
      await makeUpload(canary, 'processing', 2 * HOUR),
      await makeUpload(canary, 'pending', 2 * HOUR),
      await makeUpload(canary, 'ready', 30 * 60 * 1000),
    ];

    expect(await sweepCanaryUploads(canary.toString(), NOW)).toBe(0);

    for (const id of kept) expect(await exists(id)).toBe(true);
    expect(appSend).not.toHaveBeenCalled();
    expect(quarantineSend).not.toHaveBeenCalled();
  });

  it('keeps an infected record whose quarantine object could not be deleted, and retries it', async () => {
    const ready = await makeUpload(canary, 'ready', 2 * HOUR);
    const infected = await makeUpload(canary, 'infected', 2 * HOUR);
    quarantineSend.mockRejectedValueOnce(new Error('AccessDenied'));

    expect(await sweepCanaryUploads(canary.toString(), NOW)).toBe(1);
    expect(await exists(ready)).toBe(false);
    expect(await exists(infected)).toBe(true);

    expect(await sweepCanaryUploads(canary.toString(), NOW)).toBe(1);
    expect(await exists(infected)).toBe(false);
  });

  it('counts a key the store lists under Errors as not deleted', async () => {
    const infected = await makeUpload(canary, 'infected', 2 * HOUR);
    // DeleteObjects answers 200 and reports refusals per key.
    quarantineSend.mockResolvedValueOnce({
      Errors: [{ Key: `quarantine/${infected}/original.txt`, Code: 'AccessDenied' }],
    });

    expect(await sweepCanaryUploads(canary.toString(), NOW)).toBe(0);
    expect(await exists(infected)).toBe(true);
  });

  it('does nothing without a valid ObjectId, whatever else is in the collection', async () => {
    const all = [
      await makeUpload(canary, 'ready', 2 * HOUR),
      await makeUpload(someone, 'infected', 2 * HOUR),
    ];

    // '' and 'undefined' are what a missing variable becomes; twelve characters
    // is what Types.ObjectId.isValid would wrongly accept.
    for (const bad of ['', 'undefined', 'aaaaaaaaaaaa', 'canary@example.test', `${canary} `]) {
      expect(await sweepCanaryUploads(bad, NOW)).toBe(0);
    }

    for (const id of all) expect(await exists(id)).toBe(true);
    expect(appSend).not.toHaveBeenCalled();
    expect(quarantineSend).not.toHaveBeenCalled();
  });
});
