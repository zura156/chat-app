import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { NextFunction, Response } from 'express';
import { Types } from 'mongoose';
import {
  PRIVACY_KEYS,
  User,
  VISIBILITIES,
  Visibility,
} from '../../user/models/user.model';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';
import { UserDTO } from '../dtos/user.dto';
import {
  inaccessibleUserIds,
  isBlockedEitherWay,
} from '../services/blocking.service';
import {
  contactIdsFor,
  redactForViewer,
  withPrivacyDefaults,
} from '../services/privacy.service';

/**
 * Everything another user is allowed to see. Do not widen this: `-password`
 * alone still leaks email, verification state and lockout counters.
 */
const PUBLIC_USER_FIELDS =
  'first_name last_name username bio pfp_url pfp_variants cover_url cover_variants status last_seen createdAt';

/**
 * `privacy` rides along on every read so redactForViewer can consult it, and is
 * stripped again for anyone but the owner. Selecting it separately would mean a
 * second query per profile view.
 */
const PUBLIC_USER_FIELDS_WITH_PRIVACY = `${PUBLIC_USER_FIELDS} privacy`;

/** The caller's own record — includes account-level fields, still no password. */
const SELF_USER_FIELDS = `${PUBLIC_USER_FIELDS} email is_email_verified last_login blocked_users privacy`;

export const getPrivacySettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      next(createCustomError('Not authenticated', 401));
      return;
    }

    const user = await User.findById(req.user._id.toString())
      .select('privacy')
      .lean();

    res.status(200).json({ privacy: withPrivacyDefaults(user?.privacy) });
  } catch (error) {
    next(error);
  }
};

export const updatePrivacySettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      next(createCustomError('Not authenticated', 401));
      return;
    }

    const body = (req.body ?? {}) as Partial<Record<string, unknown>>;

    // Whitelisted both ways: only the four keys the model defines, and only the
    // three visibilities it accepts. Anything else is a client bug or an
    // attempt to write a field that is not a privacy setting.
    const update: Record<string, Visibility> = {};
    for (const key of PRIVACY_KEYS) {
      const value = body[key];
      if (value === undefined) continue;
      if (!VISIBILITIES.includes(value as Visibility)) {
        next(createCustomError(`Invalid visibility for ${key}`, 400));
        return;
      }
      update[`privacy.${key}`] = value as Visibility;
    }

    if (Object.keys(update).length === 0) {
      next(createCustomError('No privacy settings provided', 400));
      return;
    }

    await User.updateOne({ _id: req.user._id.toString() }, { $set: update });

    const user = await User.findById(req.user._id.toString())
      .select('privacy')
      .lean();

    res.status(200).json({ privacy: withPrivacyDefaults(user?.privacy) });
  } catch (error) {
    next(error);
  }
};

export const getBlockedUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      next(createCustomError('Not authenticated', 401));
      return;
    }

    const user = await User.findById(req.user._id.toString())
      .select('blocked_users')
      .populate('blocked_users', PUBLIC_USER_FIELDS);

    res.status(200).json({ users: user?.blocked_users ?? [] });
  } catch (error) {
    next(error);
  }
};

export const blockUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      next(createCustomError('Not authenticated', 401));
      return;
    }

    const id = String(req.params.id ?? '');
    const selfId = req.user._id.toString();

    if (!id || !Types.ObjectId.isValid(id)) {
      next(createCustomError('A valid user id is required', 400));
      return;
    }

    if (id === selfId) {
      next(createCustomError('You cannot block yourself', 400));
      return;
    }

    const target = await User.exists({ _id: id });
    if (!target) {
      next(createCustomError('User not found', 404));
      return;
    }

    // $addToSet rather than $push: blocking twice is not an error, and a
    // duplicated id would survive an unblock.
    await User.updateOne(
      { _id: selfId },
      { $addToSet: { blocked_users: new Types.ObjectId(id) } },
    );

    res.status(200).json({ message: 'User blocked' });
  } catch (error) {
    next(error);
  }
};

export const unblockUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      next(createCustomError('Not authenticated', 401));
      return;
    }

    const id = String(req.params.id ?? '');

    if (!id || !Types.ObjectId.isValid(id)) {
      next(createCustomError('A valid user id is required', 400));
      return;
    }

    await User.updateOne(
      { _id: req.user._id.toString() },
      { $pull: { blocked_users: new Types.ObjectId(id) } },
    );

    res.status(200).json({ message: 'User unblocked' });
  } catch (error) {
    next(error);
  }
};

export const getUserById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const id = String(req.params.id ?? '');

  try {
    if (!req.user) {
      next(createCustomError('Not authenticated!', 401));
      return;
    }

    if (!id) {
      next(createCustomError('User ID was not provided.', 400));
      return;
    }

    const viewerId = req.user._id.toString();
    const isSelf = viewerId === id;

    // A blocked user is not browsable. 404 rather than 403: whether an account
    // exists is itself something the blocker should not be broadcasting.
    if (!isSelf && (await isBlockedEitherWay(viewerId, id))) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const user = await User.findById(id)
      .select(isSelf ? SELF_USER_FIELDS : PUBLIC_USER_FIELDS_WITH_PRIVACY)
      .lean();

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const contacts = isSelf ? new Set<string>() : await contactIdsFor(viewerId);

    res.status(200).json(redactForViewer(user, viewerId, contacts));
  } catch (error) {
    console.error('Get user by id error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getCurrentUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      next(createCustomError('Not authenticated', 401));
      return;
    }

    const user = await User.findById(req.user._id.toString()).select(
      SELF_USER_FIELDS,
    );

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateUserDetails = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const updateDetails = req.body as Partial<UserDTO>;

    if (!updateDetails || Object.keys(updateDetails).length === 0) {
      res.status(400).json({ message: 'No update data provided' });
      return;
    }

    // Validate non-empty strings
    const requiredFields = ['first_name', 'last_name', 'username'] as const;
    for (const field of requiredFields) {
      if (updateDetails[field] === '') {
        res
          .status(400)
          .json({ message: `${field.replace('_', ' ')} cannot be empty` });
        return;
      }
    }

    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const user = await User.findById(req.user._id.toString()).select(
      'username first_name last_name bio',
    );

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const allowedFields = [
      'username',
      'first_name',
      'last_name',
      'bio',
    ] as const;

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        (user as any)[field] = req.body[field];
      }
    });

    await user.save();

    res.status(200).json({ message: 'User updated' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error', error });
  }
};

export const deleteUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const user = await User.findById(req.user._id.toString(), req.body);

    if (!user) {
      next(createCustomError('User not found', 404));
      return;
    }

    await user.deleteOne();

    res.status(200).json({ message: 'User deleted successfully!' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    if (!user) {
      next(createCustomError('User must be authorized!', 401));
      return;
    }

    // Discovery hides both directions of a block: someone you blocked should
    // not resurface in a list you browse, and someone who blocked you should
    // not be reachable through one.
    const hidden = await inaccessibleUserIds(user._id.toString());

    const filter = { _id: { $nin: [user._id, ...hidden] } };
    const viewerId = user._id.toString();

    const [users, totalCount, contacts] = await Promise.all([
      User.find(filter)
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(Math.min(limit, 100))
        .select(PUBLIC_USER_FIELDS_WITH_PRIVACY)
        .lean(),
      // was counting a non-existent `participants` field, so it was always 0
      User.countDocuments(filter),
      contactIdsFor(viewerId),
    ]);

    if (!users) {
      next(createCustomError('Could not fetch users!', 502));
      return;
    }

    res.status(200).json({
      users: users.map((u) => redactForViewer(u, viewerId, contacts)),
      totalCount,
    });
  } catch (err) {
    console.error('Error getting users:', err);
    res.status(500).json({ message: 'Server error getting users' });
  }
};

export const searchUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const searchQuery = req.query['q']?.toString().trim();
    const user = req.user;

    if (!searchQuery || typeof searchQuery !== 'string') {
      next(createCustomError('Search query is required', 400));
      return;
    }

    if (!user) {
      next(createCustomError('User must be authorized!', 401));
      return;
    }

    const hidden = await inaccessibleUserIds(user._id.toString());

    const viewerId = user._id.toString();

    const [users, contacts] = await Promise.all([
      User.find(
        {
          _id: { $nin: [user._id, ...hidden] },
          $text: { $search: searchQuery },
        },
        { score: { $meta: 'textScore' } },
      )
        .select(PUBLIC_USER_FIELDS_WITH_PRIVACY)
        .sort({ score: { $meta: 'textScore' } })
        .limit(50)
        .lean(),
      contactIdsFor(viewerId),
    ]);

    if (!users) {
      next(createCustomError('Could not fetch users!', 502));
      return;
    }

    res.status(200).json({
      users: users.map((u) => redactForViewer(u, viewerId, contacts)),
    });
  } catch (err) {
    console.error('Error getting users:', err);
    res.status(500).json({ message: 'Server error getting users' });
  }
};
