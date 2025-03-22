import { NextFunction, Request, Response } from 'express';
import { User } from '../../models/user.model';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { generateTokens, TokenPayload } from '../../services/jwt.service';
import { createCustomError } from '../../models/custom-api-error.model';
import jwt from 'jsonwebtoken';
import config from '../../config/config';
import { LoginDto } from '../dtos/login.dto';
import { RegisterDto } from '../dtos/register.dto';
import { RefreshTokenDto } from '../dtos/refresh-token.dto';

export const registerUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { first_name, last_name, username, email, password }: RegisterDto =
      req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      next(
        createCustomError(
          'User already exists with that email or username',
          400
        )
      );
      return;
    }

    // Create new user
    const newUser = new User({
      first_name,
      last_name,
      username,
      email,
      password,
    });

    await newUser.save();

    // Generate JWT token
    const token = generateTokens(newUser);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: newUser._id,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        username: newUser.username,
        email: newUser.email,
      },
    });
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
    }
    next(createCustomError('Server error during registration!', 500));
  }
};

export const loginUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password }: LoginDto = req.body;

    if (!email || !password) {
      next(createCustomError('Some fields might be empty!', 400));
      return;
    }

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
      res.status(404).json({ message: 'User not found!' });
      return;
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(400).json({ message: 'Invalid credentials' });
      return;
    }

    // Generate JWT token
    const token = generateTokens(user);

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
    }
    next(createCustomError('Server error during login', 500));
  }
};

export const refreshToken = (
  req: RefreshTokenDto,
  res: Response,
  next: NextFunction
): void => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const currentToken = req.headers.authorization?.split(' ')[1];
    const refreshToken = req.headers['refresh-token'];

    if (!currentToken || !refreshToken) {
      res.status(400).json({ message: 'No token provided' });
      return;
    }

    jwt.verify(
      refreshToken!,
      config.jwtSecret,
      async (err: any, decoded: TokenPayload) => {
        if (err) {
          res.status(403).json({ message: 'Invalid refresh token' });
          return;
        }

        const user = await User.findById(decoded.userId);
        if (!user || user.refreshToken !== refreshToken) {
          res.status(403).json({ message: 'Invalid refresh token' });
          return;
        }
      }
    );

    res.status(200).json({ token: newToken });
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
    }
    next(createCustomError('Server error during token refresh', 500));
  }
};
