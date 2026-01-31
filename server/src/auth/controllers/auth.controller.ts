import { NextFunction, Request, Response } from 'express';
import { User } from '../../user/models/user.model';
import { generateTokens } from '../services/jwt.service';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';
import config from '../../config/config';
import { LoginDto } from '../dtos/login.dto';
import { RegisterDto } from '../dtos/register.dto';
import { TokenModel } from '../models/token.model';
import {
  AccountTokenEnum,
  AccountTokensModel,
} from '../models/account-tokens.model';
import sendEmail from '../../utils/mailer';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../middlewares/auth.middleware';
import { csrfTokens, generateCSRFToken } from '../services/csrf.service';
import { getSecurityAlertEmailHTML } from '../../templates/security-alert-email';
import { generateLink } from '../services/auth.service';
import crypto from 'crypto';
import { redisClient } from '../../utils/redis';
import { sanitize } from 'express-mongo-sanitize';
import {
  clearRateLimit,
  loginRateLimitIncrement,
} from '../middlewares/rate-limiter';

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

export const getCSRFToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const sessionIdCookie = req.cookies.sessionId;
  if (sessionIdCookie) {
    csrfTokens.delete(sessionIdCookie);
  }

  const sessionId = crypto.randomBytes(32).toString('hex');
  const csrfToken = generateCSRFToken();

  csrfTokens.set(sessionId, csrfToken);

  res.cookie('sessionId', sessionId, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.json({ csrfToken });
};

export const registerUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { first_name, last_name, username, email, password }: RegisterDto =
      req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      res.status(409).json({ message: 'User already exists' });
      return;
    }

    // Create new user
    const user = new User({
      first_name,
      last_name,
      username,
      email,
      password,
    });

    await user.save();

    const verifyLink = await generateLink(
      AccountTokenEnum.EMAIL_VERIFICATION,
      user.id,
    );

    const emailHtml = `
        <h2>Verify Email</h2>
        <p>Please verify your email to unlock all the features on our platform. Click the link below to verify email:</p>
        <a href="${verifyLink}">Verify</a>
        <p>This link will expire in 1 hour.</p>
      `;

    await sendEmail(user.email, 'Please Verify Your Email', emailHtml);

    res.status(201).json({
      message: 'User registered successfully',
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
    next(createCustomError('Server error during registration!', 500));
  }
};

export const loginUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, password }: LoginDto = req.body;

    if (!email || !password) {
      res.status(400).json({ message: 'Some fields might be empty!' });
      return;
    }

    const sanitizedEmail = email.trim().toLowerCase();
    // Find a user
    const user = await User.findOne({ email: sanitizedEmail });

    if (!user) {
      return loginRateLimitIncrement(req, res, () => {
        res.status(404).json({ message: 'User not found!' });
      });
    }

    // Check password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return loginRateLimitIncrement(req, res, () => {
        res.status(401).json({
          message: 'Invalid credentials',
        });
      });
    }

    await clearRateLimit()(req, res, () => {});

    // generate JWT token

    const { accessToken, refreshToken } = generateTokens(user.id);

    await TokenModel.findOneAndUpdate(
      {
        user_id: user.id,
      },
      {
        $push: {
          refresh_tokens: {
            token: refreshToken,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        },
      },
      { new: true, upsert: true },
    );

    // update last login time
    await user.updateOne({
      $set: { last_login: new Date() },
    });

    // set cookies

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: 15 * 60 * 1000,
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      message: 'Login successful',
    });
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
    }
    next(createCustomError('Server error during login', 500));
  }
};

export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      res.status(401).json({ message: 'Refresh token required' });
      return;
    }

    const decoded = jwt.verify(refreshToken, config.jwtRefreshSecret) as {
      userId: string;
    };

    const refreshTokens = await TokenModel.findOne({ user_id: decoded.userId });

    if (!refreshTokens) {
      res.status(401).json({ message: 'Refresh token invalid' });
      return;
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(
      decoded.userId,
    );

    await refreshTokens.updateOne({
      $pull: { refreshTokens: { token: refreshToken } },
      $push: {
        refreshTokens: {
          token: newRefreshToken,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    });

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: 15 * 60 * 1000,
    });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ message: 'Token refreshed successfully' });
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
    }
    next(createCustomError('Server error during refreshing token', 500));
  }
};

export const logOut = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const refreshToken = req.cookies.refreshToken;
    const user = req.user;

    if (!user) {
      res.status(401).json({ message: 'User already unauthorized' });
      return;
    }

    if (refreshToken) {
      await TokenModel.findOneAndUpdate(
        { user_id: user.id },
        {
          $pull: { refreshTokens: { token: refreshToken } },
        },
      );
    }

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    res.clearCookie('sessionId');

    // Clear CSRF token
    const sessionId = req.cookies.sessionId;
    if (sessionId) {
      csrfTokens.delete(sessionId);
    }

    res.json({ message: 'Logout successful' });
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
    }
    next(createCustomError('Server error during logout', 500));
  }
};

export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ message: 'Email was not provided' });
    return;
  }

  try {
    const sanitizedEmail = email.trim().toLowerCase();
    // Find a user
    const user = await User.findOne({ email: sanitizedEmail });

    if (!user) {
      res.status(404).json({ message: 'User with provided email not found.' });
      return;
    }

    const resetLink = await generateLink(
      AccountTokenEnum.PASSWORD_RESET,
      user.id,
    );

    const emailHtml = `
        <h2>Password Reset</h2>
        <p>You requested a password reset. Click the link below to set a new password:</p>
        <a href="${resetLink}">Reset Password</a>
        <p>This link will expire in 1 hour.</p>
      `;

    await sendEmail(user.email, 'Reset your password', emailHtml);

    await TokenModel.deleteMany({ user_id: user._id });

    res
      .status(200)
      .json({ message: 'Password reset code sent to email successfully.' });
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
      return;
    }
    next(createCustomError('Server error during forgot password request', 500));
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { token, new_password, userId } = req.body;

  if (!token || !new_password) {
    res.status(400).json('Not all details were provided!');
    return;
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const resetToken = await AccountTokensModel.findOne({
      user_id: userId,
      token: hashedToken,
      type: 'password_reset',
      expires_at: { $gt: new Date() }, // not expired
    });

    if (!resetToken) {
      res.status(400).json({ message: 'Invalid or expired reset token.' });
      return;
    }

    const user = await User.findById(resetToken.user_id);
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    if (await user.comparePassword(new_password)) {
      res
        .status(400)
        .json({ message: 'New password can not be the same as the old one!' });
      return;
    }

    user.password = new_password;
    user.login_attempts = 0;
    user.lock_until = undefined;

    await user.save();
    await AccountTokensModel.deleteMany({
      user_id: user._id,
      type: 'password_reset',
    });

    res.status(200).json({
      message: 'Password reset successful.',
    });

    return;
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
      return;
    }
    next(createCustomError('Server error during forgot password request', 500));
  }
};

export const verifyEmail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { token, id } = req.body;

  if (!token) {
    res.status(400).json('Token was not provided!');
    return;
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const resetToken = await AccountTokensModel.findOne({
      user_id: id,
      token: hashedToken,
      type: 'email_verification',
      expires_at: { $gt: new Date() }, // not expired
    });

    if (!resetToken) {
      res.status(400).json({ message: 'Invalid or expired reset token.' });
      return;
    }

    const user = await User.findById(resetToken.user_id);

    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    if (user.is_email_verified) {
      res.status(409).json({ message: 'User email already verified.' });
      return;
    }

    user.is_email_verified = true;

    await user.save();
    await AccountTokensModel.deleteMany({
      user_id: user._id,
      type: 'email_verification',
    });

    res.status(200).json({
      message: 'Email verification successful.',
    });

    return;
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
      return;
    }
    next(createCustomError('Server error during forgot password request', 500));
  }
};

export const unlockAccount = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { token, userId } = req.body;

  if (!token || !userId) {
    res.status(400).json('Not all details were provided!');
    return;
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const unlockAccountToken = await AccountTokensModel.findOne({
      user_id: userId,
      token: hashedToken,
      type: 'unlock_account',
      expires_at: { $gt: new Date() }, // not expired
    });

    if (!unlockAccountToken) {
      res
        .status(400)
        .json({ message: 'Invalid or expired unlock account token.' });
      return;
    }

    const user = await User.findById(unlockAccountToken.user_id);

    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    if (!user.lock_until) {
      res.status(409).json({ message: 'User account already unlocked.' });
      return;
    }

    user.login_attempts = 0;
    user.lock_until = undefined;

    await user.save();
    await AccountTokensModel.deleteMany({
      user_id: user._id,
      type: 'email_verification',
    });

    res.status(200).json({
      message: 'Email verification successful.',
    });

    return;
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
      return;
    }
    next(createCustomError('Server error during forgot password request', 500));
  }
};
