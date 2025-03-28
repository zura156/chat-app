import { NextFunction, Request, Response } from 'express';
import { User } from '../../user/models/user.model';
import { generateTokens, TokenPayload } from '../../services/jwt.service';
import { createCustomError } from '../../models/custom-api-error.model';
import jwt from 'jsonwebtoken';
import config from '../../config/config';
import { LoginDto } from '../dtos/login.dto';
import { RegisterDto } from '../dtos/register.dto';
import { RefreshTokenDto } from '../dtos/refresh-token.dto';
import { TokenModel } from '../models/token.model';

const parseExpiry = (time: string) => {
  const duration = parseInt(time, 10);
  if (time.endsWith('s')) {
    return duration * 1000; // Convert seconds to milliseconds
  } else if (time.endsWith('m')) {
    return duration * 60 * 1000; // Convert minutes to milliseconds
  } else if (time.endsWith('h')) {
    return duration * 60 * 60 * 1000; // Convert hours to milliseconds
  } else if (time.endsWith('d')) {
    return duration * 24 * 60 * 60 * 1000; // Convert days to milliseconds
  }
  return duration; // Default case, assuming milliseconds
};

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
    const tokens: { accessToken: string; refreshToken: string } =
      generateTokens(user);

    if (!tokens) {
      next(createCustomError('Failed to generate tokens!', 500));
      return;
    }

    console.log(parseExpiry(config.jwtExpiresIn));
    console.log(parseExpiry(config.jwtRefreshTokenExpiresIn));

    await TokenModel.findOneAndUpdate(
      { user_id: user._id }, // Find by user ID
      {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        access_expiry: new Date(Date.now() + parseExpiry(config.jwtExpiresIn)),
        refresh_expiry: new Date(
          Date.now() + parseExpiry(config.jwtRefreshTokenExpiresIn)
        ),
      },
      { upsert: true, new: true } // Create if not found, return the updated doc
    );

    res.status(200).json({
      message: 'Login successful',
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
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

export const refreshToken = async (
  req: RefreshTokenDto,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const token = req.headers['refresh-token'];

    const userTokenSchema = await TokenModel.findOne({ refresh_token: token });

    if (!token) {
      res.status(400).json({ message: 'No token provided' });
      return;
    }

    if (!userTokenSchema || userTokenSchema.refresh_expiry.getTime()) {
      next(createCustomError('User not authenticated!', 401));
      return;
    }

    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    const user = await User.findById(payload.userId);

    if (!user || user.refreshToken !== token) {
      res.status(403).json({ message: 'Invalid refresh token' });
      return;
    }

    const { accessToken, refreshToken } = generateTokens(user.id);
    user.refreshToken = refreshToken;

    await user.save();

    res
      .status(200)
      .json({ access_token: accessToken, refresh_token: refreshToken });
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
    }
    next(createCustomError('Server error during token refresh', 500));
  }
};

// ! don't need it at current time.
// export const logOut = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => {
//   try {
//     await TokenModel.

//   } catch (err: any) {
//     if (err.message) {
//       next(createCustomError(err.message, 400));
//     }
//     next(createCustomError('Server error during logout', 500));
//   }
// };
