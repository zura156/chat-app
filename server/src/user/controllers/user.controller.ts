import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { NextFunction, Response } from 'express';
import { User } from '../../user/models/user.model';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';
import { UserDTO } from '../dtos/user.dto';

/**
 * Everything another user is allowed to see. Do not widen this: `-password`
 * alone still leaks email, verification state and lockout counters.
 */
const PUBLIC_USER_FIELDS =
  'first_name last_name username bio pfp_url pfp_variants cover_url cover_variants status last_seen createdAt';

/** The caller's own record — includes account-level fields, still no password. */
const SELF_USER_FIELDS = `${PUBLIC_USER_FIELDS} email is_email_verified last_login blocked_users`;

export const getUserById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { id } = req.params;

  try {
    if (!req.user) {
      next(createCustomError('Not authenticated!', 401));
      return;
    }

    if (!id) {
      next(createCustomError('User ID was not provided.', 400));
      return;
    }

    const isSelf = req.user._id.toString() === id;
    const user = await User.findById(id).select(
      isSelf ? SELF_USER_FIELDS : PUBLIC_USER_FIELDS,
    );

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(200).json(user);
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

    const filter = { _id: { $ne: user._id } };
    const [users, totalCount] = await Promise.all([
      User.find(filter)
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(Math.min(limit, 100))
        .select(PUBLIC_USER_FIELDS),
      // was counting a non-existent `participants` field, so it was always 0
      User.countDocuments(filter),
    ]);

    if (!users) {
      next(createCustomError('Could not fetch users!', 502));
      return;
    }

    res.status(200).json({ users, totalCount });
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

    const users = await User.find(
      { _id: { $ne: user._id }, $text: { $search: searchQuery } },
      { score: { $meta: 'textScore' } },
    )
      .select(PUBLIC_USER_FIELDS)
      .sort({ score: { $meta: 'textScore' } })
      .limit(50);

    if (!users) {
      next(createCustomError('Could not fetch users!', 502));
      return;
    }

    res.status(200).json({ users });
  } catch (err) {
    console.error('Error getting users:', err);
    res.status(500).json({ message: 'Server error getting users' });
  }
};
