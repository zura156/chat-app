import { Types } from 'mongoose';
import { User } from '../models/user.model';

/*
 * `blocked_users` existed on the user schema and was handed to the client, but
 * nothing could write it and nothing read it — no endpoint, and no read path
 * filtered by it. The privacy screen listed blocked users from a field that
 * could never be populated. This is the behaviour behind that field.
 *
 * A block is one-directional as data and bidirectional as an effect: the
 * blocker does not want to hear from the blocked user, and the blocked user
 * must not be able to reach them either. So every check here asks whether
 * *either* side has blocked the other, and callers never need to know which.
 */

const toId = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

/** True if either user has blocked the other. */
export const isBlockedEitherWay = async (
  a: string | Types.ObjectId,
  b: string | Types.ObjectId,
): Promise<boolean> => {
  const [first, second] = [toId(a), toId(b)];
  if (first.equals(second)) return false;

  const blocked = await User.exists({
    $or: [
      { _id: first, blocked_users: second },
      { _id: second, blocked_users: first },
    ],
  });

  return !!blocked;
};

/**
 * Everyone the given user cannot interact with: people they blocked plus
 * people who blocked them. Used to filter discovery, where the answer is
 * needed for a whole list at once rather than one pair at a time.
 */
export const inaccessibleUserIds = async (
  userId: string | Types.ObjectId,
): Promise<Types.ObjectId[]> => {
  const id = toId(userId);

  const [self, blockedBy] = await Promise.all([
    User.findById(id).select('blocked_users').lean(),
    User.find({ blocked_users: id }).select('_id').lean(),
  ]);

  const ids = new Map<string, Types.ObjectId>();
  for (const blocked of self?.blocked_users ?? []) {
    ids.set(blocked.toString(), blocked);
  }
  for (const blocker of blockedBy) {
    ids.set(blocker._id.toString(), blocker._id);
  }

  return [...ids.values()];
};

/**
 * Which of `candidates` the user cannot interact with. Same question as
 * `inaccessibleUserIds` but bounded by a known set, so it does not read every
 * blocker in the system to answer a question about one conversation.
 */
export const blockedAmong = async (
  userId: string | Types.ObjectId,
  candidates: (string | Types.ObjectId)[],
): Promise<Set<string>> => {
  const id = toId(userId);
  const others = candidates
    .map((c) => toId(c))
    .filter((c) => !c.equals(id));

  if (others.length === 0) return new Set();

  const [self, blockedBy] = await Promise.all([
    User.findById(id).select('blocked_users').lean(),
    User.find({ _id: { $in: others }, blocked_users: id })
      .select('_id')
      .lean(),
  ]);

  const selfBlocked = new Set(
    (self?.blocked_users ?? []).map((b) => b.toString()),
  );

  const result = new Set<string>();
  for (const other of others) {
    const key = other.toString();
    if (selfBlocked.has(key)) result.add(key);
  }
  for (const blocker of blockedBy) result.add(blocker._id.toString());

  return result;
};
