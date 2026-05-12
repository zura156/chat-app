import { redisClient } from '../config/redis';

interface UploadEvent {
  userId: string;
  payload: Record<string, unknown>;
}

export const emitToUser = async (
  userId: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  await redisClient.publish(
    'ws:upload',
    JSON.stringify({ userId, payload } as UploadEvent),
  );
};
