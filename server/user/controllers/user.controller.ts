import { AuthRequest } from '../../middlewares/auth.middleware';
import { NextFunction, Response } from 'express';
import { User } from '../../user/models/user.model';
import { createCustomError } from '../../models/custom-api-error.model';

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

    const user = await User.findById(req.user.userId).select([
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

    const user = await User.findByIdAndUpdate(req.user.userId, req.body);

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

    const user = await User.findById(req.user.userId, req.body);

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
