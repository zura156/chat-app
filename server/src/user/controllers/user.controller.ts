import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { NextFunction, Response } from 'express';
import { User } from '../../user/models/user.model';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';
import { compressMedia } from '../../utils/downscale-media';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 } from '../../utils/s3';

export const getUserById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
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

    const user = await User.findById(id).select([
      '-password',
      '-accessToken',
      '-refreshToken',
    ]);

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

export const getCurrentUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      next(createCustomError('Not authenticated', 401));
      return;
    }

    const user = await User.findById(req.user.id).select([
      '-password',
      '-accessToken',
      '-refreshToken',
    ]);

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
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const user = await User.findByIdAndUpdate(req.user.id, req.body);

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(200).json({ message: 'User updated' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const deleteUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const user = await User.findById(req.user.id, req.body);

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
  next: NextFunction
) => {
  try {
    const user = req.user;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    if (!user) {
      next(createCustomError('User must be authorized!', 401));
      return;
    }

    const [users, totalCount] = await Promise.all([
      User.find({ _id: { $ne: user.id } })
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .select('-password'),
      User.countDocuments({ participants: user.id }),
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
  next: NextFunction
) => {
  try {
    const searchQuery = req.query['q'];
    const user = req.user;

    if (!searchQuery) {
      next(createCustomError('Search query is required', 400));
      return;
    }

    if (!user) {
      next(createCustomError('User must be authorized!', 401));
      return;
    }

    const users = await User.find({
      _id: { $ne: user.id },
      $or: [
        { first_name: { $regex: searchQuery, $options: 'i' } },
        { last_name: { $regex: searchQuery, $options: 'i' } },
        { username: { $regex: searchQuery, $options: 'i' } },
      ],
    });

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

export const updateProfilePicture = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      next(createCustomError('Not authenticated', 401));
      return;
    }
    const user = await User.findById(req.user.id);
    if (!user) {
      next(createCustomError('User not found', 404));
      return;
    }

    const profilePicture = req.file;
    if (!profilePicture) {
      next(createCustomError('Profile picture data is required', 400));
      return;
    }

    const fileBuffer = Buffer.from(profilePicture.buffer);

    // Usage
    const compressedPicture = await compressMedia(fileBuffer, 'image/jpeg', {
      maxDimension: 1920,
      quality: 80,
      outputFormat: 'webp',
    });

    const fileKey = `${Date.now()}-${profilePicture.filename}`;

    const command = new PutObjectCommand({
      Bucket: 'profile-pictures',
      Key: fileKey,
      ContentType: profilePicture.mimetype,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    res.status(200).json({ url: uploadUrl, profilePicture: compressedPicture });
  } catch (error) {
    console.error('Update profile picture error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
