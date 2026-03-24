import { NextFunction, Request, Response } from 'express';
import { User } from '../user/models/user.model';
import { generateTokens } from './services/jwt.service';
import { createCustomError } from '../error-handling/models/custom-api-error.model';
import config from '../config/config';
import { LoginDto } from './dtos/login.dto';
import { RegisterDto } from './dtos/register.dto';
import {
  AccountTokenEnum,
  AccountTokensModel,
} from './models/account-tokens.model';
import sendEmail from '../utils/mailer';
import jwt from 'jsonwebtoken';
import { AuthRequest } from './middlewares/auth.middleware';
import { generateLink } from './services/auth.service';
import crypto from 'crypto';
import {
  clearRateLimit,
  clearRateLimitMiddleware,
  forgotPasswordRateLimitIncrement,
  loginRateLimitIncrement,
} from './middlewares/rate-limiter';
import {
  storeRefreshToken,
  validateRefreshToken,
  rotateRefreshToken,
  deleteRefreshToken,
  deleteAllUserRefreshTokens,
  blacklistAccessToken,
} from './services/token.service';

// ─── Cookie helpers ────────────────────────────────────────────────────────────

const COOKIE_BASE = {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: (config.nodeEnv === 'production' ? 'none' : 'lax') as
    | 'none'
    | 'lax',
};

const setAuthCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string,
) => {
  const csrfToken = crypto.randomBytes(32).toString('hex');

  res.cookie('accessToken', accessToken, {
    ...COOKIE_BASE,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refreshToken', refreshToken, {
    ...COOKIE_BASE,
    path: '/auth/refresh',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  // NOT httpOnly — client JS must read and send as X-CSRF-TOKEN header
  res.cookie('csrfToken', csrfToken, {
    httpOnly: false,
    secure: config.nodeEnv === 'production',
    sameSite: (config.nodeEnv === 'production' ? 'none' : 'lax') as
      | 'none'
      | 'lax',
    domain: config.nodeEnv === 'production' ? '.zura156.xyz' : undefined,
    maxAge: 15 * 60 * 1000, // matches accessToken lifetime
  });
};

const clearAuthCookies = (res: Response) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken', { path: '/auth/refresh' });
  res.clearCookie('csrfToken');
};

// ─── Controllers ───────────────────────────────────────────────────────────────

export const registerUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { first_name, last_name, username, email, password }: RegisterDto =
      req.body;

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      res.status(409).json({ message: 'User already exists' });
      return;
    }

    const user = new User({ first_name, last_name, username, email, password });
    await user.save();

    const verifyLink = await generateLink(
      AccountTokenEnum.EMAIL_VERIFICATION,
      user.id,
    );
    await sendEmail(
      user.email,
      'Please Verify Your Email',
      `<h2>Verify Email</h2>
       <p>Click the link below to verify your email:</p>
       <a href="${verifyLink}">Verify</a>
       <p>This link will expire in 1 hour.</p>`,
    );

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
    if (error.message) return next(createCustomError(error.message, 400));
    return next(createCustomError('Server error during registration!', 500));
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
    const user = await User.findOne({ email: sanitizedEmail });

    if (!user) {
      return loginRateLimitIncrement(req, res, () => {
        res.status(404).json({ message: 'User not found!' });
      });
    }

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return loginRateLimitIncrement(req, res, () => {
        res.status(401).json({ message: 'Invalid credentials' });
      });
    }

    await clearRateLimitMiddleware(req, res, () => {});

    const { accessToken, refreshToken } = generateTokens(user.id);
    await storeRefreshToken(user.id, refreshToken);
    await user.updateOne({ $set: { last_login: new Date() } });

    setAuthCookies(res, accessToken, refreshToken);
    res.status(200).json({ message: 'Login successful' });
  } catch (error: any) {
    if (error.message) return next(createCustomError(error.message, 400));
    return next(createCustomError('Server error during login', 500));
  }
};

export const refreshAccessToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = req.cookies.refreshToken as string | undefined;

    if (!token) {
      res.status(401).json({ message: 'Refresh token required' });
      return;
    }

    const decoded = jwt.verify(token, config.jwtRefreshSecret) as {
      userId: string;
    };

    const isValid = await validateRefreshToken(decoded.userId, token);
    if (!isValid) {
      res.status(401).json({ message: 'Refresh token invalid or expired' });
      return;
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(
      decoded.userId,
    );
    const rotated = await rotateRefreshToken(
      decoded.userId,
      token,
      newRefreshToken,
    );

    if (!rotated) {
      // Reuse detected — all sessions already wiped inside rotateRefreshToken
      clearAuthCookies(res);
      res
        .status(401)
        .json({ message: 'Token reuse detected. All sessions revoked.' });
      return;
    }

    setAuthCookies(res, accessToken, newRefreshToken);
    res.json({ message: 'Token refreshed successfully' });
  } catch (error: any) {
    if (error.message) return next(createCustomError(error.message, 400));
    return next(createCustomError('Server error during token refresh', 500));
  }
};

export const logOut = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const refreshToken = req.cookies.refreshToken as string | undefined;
    const accessToken = req.cookies.accessToken as string | undefined;

    // Blacklist the access token for remainder of its TTL
    if (accessToken) {
      try {
        const decoded = jwt.decode(accessToken) as { exp?: number };
        if (decoded?.exp) await blacklistAccessToken(accessToken, decoded.exp);
      } catch {
        // non-critical, continue logout
      }
    }

    if (refreshToken) {
      await deleteRefreshToken(user._id.toString(), refreshToken);
    }

    clearAuthCookies(res);
    res.json({ message: 'Logout successful' });
  } catch (error: any) {
    if (error.message) return next(createCustomError(error.message, 400));
    return next(createCustomError('Server error during logout', 500));
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
    const user = await User.findOne({ email: sanitizedEmail });

    if (!user) {
      return forgotPasswordRateLimitIncrement(req, res, () => {
        res
          .status(200)
          .json({ message: 'Password reset link sent if email exists.' });
      });
    }

    const resetLink = await generateLink(
      AccountTokenEnum.PASSWORD_RESET,
      user.id,
    );
    await sendEmail(
      user.email,
      'Reset your password',
      `<h2>Password Reset</h2>
       <p>Click the link below to set a new password:</p>
       <a href="${resetLink}">Reset Password</a>
       <p>This link will expire in 1 hour.</p>`,
    );

    // Do NOT wipe sessions here — user is still legitimately logged in on their devices
    res
      .status(200)
      .json({ message: 'Password reset link sent if email exists.' });
  } catch (error: any) {
    if (error.message) return next(createCustomError(error.message, 400));
    return next(
      createCustomError('Server error during forgot password request', 500),
    );
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { token, new_password, userId } = req.body;

  if (!token || !new_password || !userId) {
    res.status(400).json({ message: 'Not all details were provided!' });
    return;
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const resetToken = await AccountTokensModel.findOne({
      user_id: userId,
      token: hashedToken,
      type: 'password_reset',
      expires_at: { $gt: new Date() },
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
        .json({ message: 'New password cannot be the same as the old one!' });
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

    // Force logout from all devices after password reset
    await deleteAllUserRefreshTokens(user._id.toString());

    clearAuthCookies(res);
    res.status(200).json({ message: 'Password reset successful.' });
  } catch (error: any) {
    if (error.message) return next(createCustomError(error.message, 400));
    return next(createCustomError('Server error during password reset', 500));
  }
};

export const verifyEmail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { token, id } = req.body;

  if (!token || !id) {
    res.status(400).json({ message: 'Token and id are required!' });
    return;
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const verifyToken = await AccountTokensModel.findOne({
      user_id: id,
      token: hashedToken,
      type: 'email_verification',
      expires_at: { $gt: new Date() },
    });

    if (!verifyToken) {
      res
        .status(400)
        .json({ message: 'Invalid or expired verification token.' });
      return;
    }

    const user = await User.findById(verifyToken.user_id);
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    if (user.is_email_verified) {
      res.status(409).json({ message: 'Email already verified.' });
      return;
    }

    user.is_email_verified = true;
    await user.save();
    await AccountTokensModel.deleteMany({
      user_id: user._id,
      type: 'email_verification',
    });

    res.status(200).json({ message: 'Email verification successful.' });
  } catch (error: any) {
    if (error.message) return next(createCustomError(error.message, 400));
    return next(
      createCustomError('Server error during email verification', 500),
    );
  }
};

export const unlockAccount = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { token, userId } = req.body;

  if (!token || !userId) {
    res.status(400).json({ message: 'Not all details were provided!' });
    return;
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const unlockToken = await AccountTokensModel.findOne({
      user_id: userId,
      token: hashedToken,
      type: 'unlock_account',
      expires_at: { $gt: new Date() },
    });

    if (!unlockToken) {
      res.status(400).json({ message: 'Invalid or expired unlock token.' });
      return;
    }

    const user = await User.findById(unlockToken.user_id);
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    if (!user.lock_until) {
      res.status(409).json({ message: 'Account is not locked.' });
      return;
    }

    user.login_attempts = 0;
    user.lock_until = undefined;

    await user.save();
    await AccountTokensModel.deleteMany({
      user_id: user._id,
      type: 'unlock_account',
    });

    res.status(200).json({ message: 'Account unlocked successfully.' });
  } catch (error: any) {
    if (error.message) return next(createCustomError(error.message, 400));
    return next(createCustomError('Server error during account unlock', 500));
  }
};
export const getCsrfToken = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const csrfToken = crypto.randomBytes(32).toString('hex');

  res.cookie('csrfToken', csrfToken, {
    httpOnly: false,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    maxAge: 15 * 60 * 1000,
  });

  res.status(200).json({ message: 'CSRF token set in cookie' });
};
