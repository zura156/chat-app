import { imageHandler } from './image.handler';
import { JobPayload, ProcessResult } from './types';
import config from '../../config/config';

/*
 * same as imageHandler but targets s3PrivateBucket
 */
export const dmImageHandler = async (
  payload: JobPayload,
): Promise<ProcessResult> => {
  const result = await imageHandler(payload);
  // DM images go to private bucket — override bucket in result
  return { ...result, finalBucket: config.s3PrivateBucket };
};
