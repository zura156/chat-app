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
import { deleteAccount } from '../services/account-deletion.service';
import { clampLimit, clampOffset } from '../../utils/pagination';
import { clearAuthCookies } from '../../auth/auth.controller';

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
// `pending_email` is included so the account screen can show an outstanding
// address change and offer to cancel it. Self-only, like `email` itself.
const SELF_USER_FIELDS = `${PUBLIC_USER_FIELDS} email pending_email is_email_verified last_login blocked_users privacy`;

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

    if (!id || !Types.ObjectId.isValid(id)) {
      // Unvalidated, this reached Mongoose as a CastError and surfaced as a
      // 500 — every other id-taking route here already checked.
      next(createCustomError('A valid user id is required', 400));
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
    next(error);
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
    next(error);
  }
};

/** Length ceilings for the free-text profile fields. */
const FIELD_LIMITS = {
  username: { min: 3, max: 32 },
  first_name: { min: 1, max: 64 },
  last_name: { min: 1, max: 64 },
  bio: { min: 0, max: 500 },
} as const;

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export const updateUserDetails = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const body = (req.body ?? {}) as Partial<UserDTO>;
    const allowedFields = Object.keys(
      FIELD_LIMITS,
    ) as (keyof typeof FIELD_LIMITS)[];

    const updates: Partial<Record<keyof typeof FIELD_LIMITS, string>> = {};

    for (const field of allowedFields) {
      const value = body[field];
      if (value === undefined) continue;

      if (typeof value !== 'string') {
        next(createCustomError(`${field.replace('_', ' ')} must be text`, 400));
        return;
      }

      // Unbounded before: `bio` in particular had no ceiling at any layer, so
      // the only limit on what a user could store was the 1 MB body parser.
      const trimmed = value.trim();
      const { min, max } = FIELD_LIMITS[field];

      if (trimmed.length < min) {
        next(
          createCustomError(`${field.replace('_', ' ')} cannot be empty`, 400),
        );
        return;
      }

      if (trimmed.length > max) {
        next(
          createCustomError(
            `${field.replace('_', ' ')} must be at most ${max} characters`,
            400,
          ),
        );
        return;
      }

      if (field === 'username' && !USERNAME_PATTERN.test(trimmed)) {
        next(
          createCustomError(
            'Username may only contain letters, numbers, dots, underscores and hyphens',
            400,
          ),
        );
        return;
      }

      updates[field] = trimmed;
    }

    if (Object.keys(updates).length === 0) {
      next(createCustomError('No update data provided', 400));
      return;
    }

    // Checked up front so a taken name comes back as a 409 the form can show,
    // rather than as a save-time E11000 that the old catch turned into a 500
    // with the raw Mongo error attached to the response.
    if (updates.username) {
      const taken = await User.exists({
        username: updates.username,
        _id: { $ne: req.user._id },
      });

      if (taken) {
        next(createCustomError('That username is already taken', 409));
        return;
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id.toString(),
      { $set: updates },
      { returnDocument: 'after', runValidators: true },
    ).select(SELF_USER_FIELDS);

    if (!user) {
      next(createCustomError('User not found', 404));
      return;
    }

    // Returning the updated record saves the client a refetch it was
    // previously forced into by a bare success message.
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

/**
 * Closes the account for good.
 *
 * Two things were wrong here. The lookup passed `req.body` as the second
 * argument to `findById`, which is the *projection* — so the shape of the
 * document being loaded was whatever JSON the caller sent. And the deletion
 * removed only the user row, leaving their messages, uploads, stored objects,
 * notifications, mutes, tokens and every other user's block list intact.
 *
 * It also cost nothing but a session cookie. An irreversible destructive action
 * on the caller's own account is exactly the case for re-entering the password.
 */
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

    const { password } = (req.body ?? {}) as { password?: unknown };

    if (typeof password !== 'string' || !password) {
      next(
        createCustomError(
          'Your password is required to delete your account',
          400,
        ),
      );
      return;
    }

    const user = await User.findById(req.user._id.toString());

    if (!user) {
      next(createCustomError('User not found', 404));
      return;
    }

    if (!(await user.comparePassword(password))) {
      next(createCustomError('That password is not correct', 401));
      return;
    }

    await deleteAccount(user._id as Types.ObjectId);

    clearAuthCookies(res);
    res.status(200).json({ message: 'User deleted successfully!' });
  } catch (error) {
    next(error);
  }
};

export const getUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user;
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);

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
        .limit(limit)
        .skip(offset)
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
    next(err);
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
    next(err);
  }
};
