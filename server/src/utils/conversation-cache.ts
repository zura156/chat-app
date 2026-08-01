import { redisClient } from '../config/redis';
import { logger } from './logger';

export const participantsCacheKey = (conversationId: string): string =>
  `conv:participants:${conversationId}`;

/**
 * Drop the cached participant list for a conversation.
 * Must be called whenever membership changes, otherwise broadcasts keep going
 * to the old set of users for the remainder of the cache TTL.
 */
export const invalidateParticipantsCache = async (
  conversationId: string,
): Promise<void> => {
  try {
    await redisClient.del(participantsCacheKey(conversationId));
  } catch (error) {
    logger.error(
      `Failed to invalidate participants cache for ${conversationId}:`,
      error,
    );
  }
};
