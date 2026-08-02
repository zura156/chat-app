import { imageHandler } from './image.handler';
import { JobPayload, ProcessResult } from './types';
import config from '../../config/config';

/*
 * same as imageHandler but targets s3PrivateBucket
 *
 * NOTE: this used to call imageHandler() and then override `finalBucket` on the
 * result, which only relabelled metadata — the bytes and the URLs still went to
 * the public bucket. The bucket has to be passed *into* the handler.
 */
export const dmImageHandler = async (
  payload: JobPayload,
): Promise<ProcessResult> => imageHandler(payload, config.s3PrivateBucket);
