import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3App } from '../config/s3';
import config from '../config/config';
import { logger } from '../utils/logger';

/**
 * Private-bucket objects (everything sent inside a conversation) are not
 * readable without a signature. Attachment URLs are stored unsigned and signed
 * on the way out, so the stored document stays canonical and a signature can
 * never be persisted or leak past its lifetime.
 */
const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60; // 6h — long enough for a session

/**
 * Signatures are generated against a timestamp rounded down to the hour so the
 * same object yields a byte-identical URL for everyone within that hour.
 * Without this every read produces a fresh signature, the `src` of every image
 * changes on each refetch, and the browser re-downloads media it already has.
 */
const SIGNING_WINDOW_MS = 60 * 60 * 1000;

const privatePrefix = (): string =>
  `${config.s3Url}/${config.s3PrivateBucket}/`;

const currentSigningDate = (): Date =>
  new Date(Math.floor(Date.now() / SIGNING_WINDOW_MS) * SIGNING_WINDOW_MS);

/** Signs a stored URL if it points at the private bucket; passes others through. */
export const signPrivateUrl = async (url: string): Promise<string> => {
  const prefix = privatePrefix();
  if (typeof url !== 'string' || !url.startsWith(prefix)) return url;

  const key = url.slice(prefix.length);

  try {
    return await getSignedUrl(
      s3App,
      new GetObjectCommand({ Bucket: config.s3PrivateBucket, Key: key }),
      {
        expiresIn: SIGNED_URL_TTL_SECONDS,
        signingDate: currentSigningDate(),
      },
    );
  } catch (error) {
    logger.error(`Failed to sign media url for key ${key}:`, error);
    return url;
  }
};

export const signVariants = async (
  variants: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown> | null> => {
  if (!variants || typeof variants !== 'object') return null;

  const entries = await Promise.all(
    Object.entries(variants).map(async ([name, value]) => [
      name,
      typeof value === 'string' ? await signPrivateUrl(value) : value,
    ]),
  );

  return Object.fromEntries(entries);
};

type AttachmentLike = { variants?: Record<string, unknown> | null };

export const signAttachments = async <T extends AttachmentLike>(
  attachments: T[] | undefined,
): Promise<T[]> => {
  if (!attachments?.length) return attachments ?? [];

  return Promise.all(
    attachments.map(async (attachment) => ({
      ...attachment,
      variants: await signVariants(attachment.variants),
    })),
  );
};

type MessageLike = {
  toObject?: () => Record<string, any>;
  attachments?: AttachmentLike[];
};

/** Returns a plain object with every private attachment URL signed. */
export const signMessage = async (message: MessageLike): Promise<any> => {
  const plain = message.toObject ? message.toObject() : { ...message };
  if (!plain.attachments?.length) return plain;

  return { ...plain, attachments: await signAttachments(plain.attachments) };
};

export const signMessages = async (messages: MessageLike[]): Promise<any[]> =>
  Promise.all(messages.map((message) => signMessage(message)));
