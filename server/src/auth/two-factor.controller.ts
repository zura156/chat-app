import { NextFunction, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest } from './middlewares/auth.middleware';
import { TwoFactorAuthModel } from './models/two-factor.model';
import {
  buildOtpAuthUri,
  generateSecret,
  verifyCode,
} from './services/totp.service';
import { deleteAllUserRefreshTokens } from './services/token.service';
import { createCustomError } from '../error-handling/models/custom-api-error.model';
import config from '../config/config';

/** How long an unconfirmed enrolment stays valid. */
const SETUP_WINDOW_MS = 10 * 60 * 1000;

const RECOVERY_CODE_COUNT = 8;

const hashRecoveryCode = (code: string) =>
  crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');

/**
 * Human-transcribable: no lowercase, no 0/O/1/I. These get written down, so
 * the alphabet matters more than the extra bits a wider one would buy.
 */
const generateRecoveryCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}`;
};

export const getTwoFactorStatus = async (
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

    const record = await TwoFactorAuthModel.findOne({
      user_id: user._id,
    }).lean();

    res.status(200).json({
      enabled: !!record?.two_factor_enabled,
      pending: !!record && !record.two_factor_enabled,
      recovery_codes_remaining: record?.two_factor_enabled
        ? (record.recovery_codes?.length ?? 0)
        : 0,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Begins enrolment: mints a secret and hands back the otpauth URI. The secret
 * is returned exactly once, here — it is what the authenticator app stores, and
 * it is not retrievable afterwards.
 */
export const beginTwoFactorSetup = async (
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

    const existing = await TwoFactorAuthModel.findOne({ user_id: user._id });
    if (existing?.two_factor_enabled) {
      next(createCustomError('Two-factor authentication is already on', 409));
      return;
    }

    const secret = generateSecret();
    const expires_at = new Date(Date.now() + SETUP_WINDOW_MS);

    // Restarting setup replaces any half-finished attempt rather than
    // accumulating secrets nobody confirmed.
    await TwoFactorAuthModel.findOneAndUpdate(
      { user_id: user._id },
      {
        $set: {
          secret,
          expires_at,
          two_factor_enabled: false,
          recovery_codes: [],
        },
        $unset: { confirmed_at: 1 },
      },
      { upsert: true },
    );

    res.status(200).json({
      secret,
      otpauth_uri: buildOtpAuthUri(
        secret,
        user.email ?? user.username,
        config.twoFactorIssuer,
      ),
      expires_at,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Finishes enrolment by requiring a code the secret produces. This is the proof
 * the user actually stored it; only now does 2FA turn on.
 */
export const confirmTwoFactorSetup = async (
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

    const { code } = req.body ?? {};
    const record = await TwoFactorAuthModel.findOne({ user_id: user._id });

    if (!record) {
      next(createCustomError('Start two-factor setup first', 400));
      return;
    }

    if (record.two_factor_enabled) {
      next(createCustomError('Two-factor authentication is already on', 409));
      return;
    }

    if (record.expires_at && record.expires_at.getTime() < Date.now()) {
      next(createCustomError('Setup expired — start again', 410));
      return;
    }

    if (!verifyCode(record.secret, String(code ?? ''))) {
      next(createCustomError('That code is not correct', 400));
      return;
    }

    // Shown once, stored hashed: a recovery code is a password-equivalent, and
    // keeping the plaintext would make the database a bypass for the factor it
    // is supposed to protect.
    const plaintextCodes = Array.from(
      { length: RECOVERY_CODE_COUNT },
      generateRecoveryCode,
    );

    record.two_factor_enabled = true;
    record.confirmed_at = new Date();
    record.expires_at = undefined;
    record.recovery_codes = plaintextCodes.map(hashRecoveryCode);
    await record.save();

    res.status(200).json({
      enabled: true,
      recovery_codes: plaintextCodes,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Turning 2FA off requires a current code — otherwise anyone holding a live
 * session could quietly remove the second factor.
 */
export const disableTwoFactor = async (
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

    const { code } = req.body ?? {};
    const record = await TwoFactorAuthModel.findOne({ user_id: user._id });

    if (!record?.two_factor_enabled) {
      next(createCustomError('Two-factor authentication is not on', 400));
      return;
    }

    const submitted = String(code ?? '');
    const byCode = verifyCode(record.secret, submitted);
    const byRecovery = record.recovery_codes.includes(
      hashRecoveryCode(submitted.replace(/\s/g, '')),
    );

    if (!byCode && !byRecovery) {
      next(createCustomError('That code is not correct', 400));
      return;
    }

    await record.deleteOne();

    // Removing a factor invalidates every session but this one: if it was
    // removed because the account is compromised, the attacker's sessions have
    // to go with it.
    await deleteAllUserRefreshTokens(user._id.toString());

    res.status(200).json({ enabled: false });
  } catch (error) {
    next(error);
  }
};
