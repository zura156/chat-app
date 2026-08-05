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

/**
 * Identifies this publisher on `ws:broadcast`.
 *
 * API instances skip messages carrying their own id, because they already
 * delivered to their local sockets before publishing. The worker holds no
 * sockets, so it must never match a live instance — every API process has to
 * act on what it sends. A constant that is not an instance id does that.
 */
const WORKER_PUBLISHER_ID = 'worker';

/**
 * Sends an already-formed WebSocket payload to a set of users.
 *
 * `WebSocketService.broadcast` is the usual route, but it is bound to the
 * socket server and therefore only exists inside the API process. The worker
 * runs separately, so anything it needs to push — a system message about an
 * upload it just finished, for instance — has to go on the wire directly.
 */
export const broadcastToParticipants = async (
  participantIds: string[],
  payload: Record<string, unknown>,
): Promise<void> => {
  if (!participantIds.length) return;

  await redisClient.publish(
    'ws:broadcast',
    JSON.stringify({
      participantIds: [...new Set(participantIds.map(String))],
      payload,
      fromInstance: WORKER_PUBLISHER_ID,
    }),
  );
};
