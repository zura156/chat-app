import { NextFunction, Response } from 'express';
import { AuthRequest } from './middlewares/auth.middleware';
import {
  ITwoFactorAuth,
  TwoFactorAuthModel,
  TwoFactorMethod,
  enrolledMethods,
} from './models/two-factor.model';
import {
  buildOtpAuthUri,
  generateSecret,
  verifyAndConsumeCode,
} from './services/totp.service';
import {
  EMAIL_OTP_TTL_SECONDS,
  clearEmailCode,
  issueEmailCode,
  verifyAndConsumeEmailCode,
} from './services/email-otp.service';
import {
  findRecoveryCodeIndex,
  generateRecoveryCodes,
  hashRecoveryCode,
} from './services/recovery-code.service';
import {
  deleteAllUserRefreshTokens,
  revokeSessionsBefore,
} from './services/token.service';
import { createCustomError } from '../error-handling/models/custom-api-error.model';
import { resetRateLimit } from './middlewares/rate-limiter';
import config from '../config/config';
import { User } from '../user/models/user.model';
import sendEmail from '../utils/mailer';
import { getTwoFactorCodeEmailHTML } from '../templates/two-factor-code-email';
import { logger } from '../utils/logger';

/**
 * Re-checks the caller's password before a change to their second factor.
 *
 * A live session was previously the only thing standing between an attacker and
 * enrolling *their* authenticator on the account — which locks the real owner
 * out while looking, to every subsequent check, exactly like a properly secured
 * account. Anything that alters the factors must cost the password.
 */
const assertPassword = async (
  userId: string,
  password: unknown,
): Promise<void> => {
  if (typeof password !== 'string' || !password) {
    throw createCustomError('Your password is required', 400);
  }

  // req.user comes from a projection that excludes the hash.
  const user = await User.findById(userId).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw createCustomError('That password is not correct', 401);
  }
};

/** How long an unconfirmed TOTP enrolment stays valid. */
const SETUP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Proves the caller holds a factor that is *already* in force.
 *
 * Adding a factor costs the password. Removing one costs the password and a
 * working code, because removal is what an attacker wants: it is the step that
 * turns a stolen session into a permanently weaker account.
 *
 * Any enrolled factor answers for any other — if TOTP and email are both on,
 * either code (or a recovery code) authorises removing either. Requiring the
 * specific factor being removed would mean a user whose authenticator is
 * already lost could never remove it, which is the state they are most likely
 * to be in when they try.
 */
const verifyAnyEnrolledFactor = async (
  record: ITwoFactorAuth,
  userId: string,
  submitted: string,
): Promise<{ ok: boolean; usedRecoveryIndex: number }> => {
  const code = String(submitted ?? '').replace(/\s/g, '');
  if (!code) return { ok: false, usedRecoveryIndex: -1 };

  if (record.two_factor_enabled && record.secret) {
    if (await verifyAndConsumeCode(userId, record.secret, code)) {
      return { ok: true, usedRecoveryIndex: -1 };
    }
  }

  if (record.email_enabled) {
    if (await verifyAndConsumeEmailCode(userId, 'login', code)) {
      return { ok: true, usedRecoveryIndex: -1 };
    }
  }

  const recoveryIndex = findRecoveryCodeIndex(record.recovery_codes, code);
  return { ok: recoveryIndex !== -1, usedRecoveryIndex: recoveryIndex };
};

/** The status payload, derived in one place so every route agrees on it. */
const statusOf = (record: ITwoFactorAuth | null) => {
  const methods = enrolledMethods(record);

  return {
    // "Is the account protected", which is what the settings screen renders.
    enabled: methods.length > 0,
    methods,
    totp_enabled: !!record?.two_factor_enabled,
    email_enabled: !!record?.email_enabled,
    // A TOTP enrolment that was started and never confirmed. An expired one is
    // not pending: it no longer accepts codes, and reporting it as in-progress
    // left the screen offering a step that could only fail.
    totp_pending:
      !!record &&
      !record.two_factor_enabled &&
      !!record.secret &&
      (!record.expires_at || record.expires_at.getTime() > Date.now()),
    recovery_codes_remaining:
      methods.length > 0 ? (record?.recovery_codes?.length ?? 0) : 0,
  };
};

/**
 * Recovery codes belong to the account, not to a factor: they are minted when
 * the first factor is confirmed and left alone when a second is added. Reissuing
 * them on every enrolment would silently invalidate the set the user has
 * already written down.
 */
const ensureRecoveryCodes = (
  record: ITwoFactorAuth,
): string[] | null => {
  if (record.recovery_codes.length > 0) return null;

  const plaintext = generateRecoveryCodes();
  record.recovery_codes = plaintext.map(hashRecoveryCode);
  return plaintext;
};

/**
 * Tears the record down once nothing is left in force, and signs every session
 * out with it.
 *
 * The revocation is deliberately scoped to the account dropping all the way
 * back to password-only. Turning off one of two factors leaves the account
 * still holding a second one, and signing every device out for that is friction
 * with no threat behind it; going down to a bare password is the change worth
 * treating as "this may be how a compromise ends".
 */
const finalizeRemoval = async (
  record: ITwoFactorAuth,
  userId: string,
): Promise<{ signedOut: boolean }> => {
  if (enrolledMethods(record).length > 0) {
    await record.save();
    return { signedOut: false };
  }

  await record.deleteOne();
  await clearEmailCode(userId, 'login');
  await clearEmailCode(userId, 'enroll');
  await deleteAllUserRefreshTokens(userId);
  await revokeSessionsBefore(userId);
  return { signedOut: true };
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

    const record = await TwoFactorAuthModel.findOne({ user_id: user._id });
    res.status(200).json(statusOf(record));
  } catch (error) {
    next(error);
  }
};

// ─── Authenticator app ───────────────────────────────────────────────────────

/**
 * Begins TOTP enrolment: mints a secret and hands back the otpauth URI. The
 * secret is returned exactly once, here — it is what the authenticator app
 * stores, and it is not retrievable afterwards.
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
      next(createCustomError('An authenticator app is already set up', 409));
      return;
    }

    await assertPassword(user._id.toString(), req.body?.password);

    const secret = generateSecret();
    const expires_at = new Date(Date.now() + SETUP_WINDOW_MS);

    /*
     * Restarting setup replaces any half-finished attempt rather than
     * accumulating secrets nobody confirmed — but it must not touch the email
     * factor or the recovery codes. Those used to be reset here unconditionally
     * (`recovery_codes: []`), which meant a user with email 2FA who merely
     * *opened* the authenticator setup had the codes they had written down
     * silently invalidated, whether or not they went through with it.
     */
    const record =
      existing ??
      new TwoFactorAuthModel({ user_id: user._id, two_factor_enabled: false });

    record.secret = secret;
    record.expires_at = expires_at;
    record.two_factor_enabled = false;
    record.confirmed_at = undefined;
    await record.save();

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
 * Finishes TOTP enrolment by requiring a code the secret produces. This is the
 * proof the user actually stored it; only now does the factor turn on.
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

    if (!record?.secret) {
      next(createCustomError('Start authenticator setup first', 400));
      return;
    }

    if (record.two_factor_enabled) {
      next(createCustomError('An authenticator app is already set up', 409));
      return;
    }

    if (record.expires_at && record.expires_at.getTime() < Date.now()) {
      next(createCustomError('Setup expired — start again', 410));
      return;
    }

    if (
      !(await verifyAndConsumeCode(
        user._id.toString(),
        record.secret,
        String(code ?? ''),
      ))
    ) {
      next(createCustomError('That code is not correct', 400));
      return;
    }

    await resetRateLimit(req);

    record.two_factor_enabled = true;
    record.confirmed_at = new Date();
    record.expires_at = undefined;

    // Shown once, stored hashed: a recovery code is password-equivalent, and
    // keeping the plaintext would make the database a bypass for the factor it
    // is supposed to protect.
    const plaintextCodes = ensureRecoveryCodes(record);
    await record.save();

    res.status(200).json({
      ...statusOf(record),
      recovery_codes: plaintextCodes ?? [],
    });
  } catch (error) {
    next(error);
  }
};

// ─── Email codes ─────────────────────────────────────────────────────────────

/**
 * Begins email enrolment by sending a code to the address on the account.
 *
 * The address is not a parameter. Letting the caller name one would make this a
 * way to point a second factor at an inbox the account owner does not control —
 * changing where codes go is what /change-email is for, and that flow verifies
 * the new address on its own terms.
 */
export const beginEmailTwoFactorSetup = async (
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

    const record = await TwoFactorAuthModel.findOne({ user_id: user._id });
    if (record?.email_enabled) {
      next(createCustomError('Email codes are already set up', 409));
      return;
    }

    await assertPassword(user._id.toString(), req.body?.password);

    if (!user.email) {
      next(
        createCustomError(
          'Your account has no email address to send codes to',
          400,
        ),
      );
      return;
    }

    const issued = await issueEmailCode(user._id.toString(), 'enroll');
    if (issued) {
      await sendEmail(
        user.email,
        'Confirm email for two-factor authentication',
        getTwoFactorCodeEmailHTML(
          issued.code,
          Math.round(EMAIL_OTP_TTL_SECONDS / 60),
          'enroll',
        ),
      );
    }

    // The same answer whether or not this send was throttled: the user's next
    // step is identical either way, and the difference is not theirs to act on.
    res.status(200).json({
      sent_to: user.email,
      expires_in_seconds: EMAIL_OTP_TTL_SECONDS,
    });
  } catch (error) {
    next(error);
  }
};

/** Turns the email factor on once a delivered code comes back. */
export const confirmEmailTwoFactorSetup = async (
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
    const userId = user._id.toString();

    const existing = await TwoFactorAuthModel.findOne({ user_id: user._id });
    if (existing?.email_enabled) {
      next(createCustomError('Email codes are already set up', 409));
      return;
    }

    if (!(await verifyAndConsumeEmailCode(userId, 'enroll', String(code ?? '')))) {
      next(createCustomError('That code is not correct or has expired', 400));
      return;
    }

    await resetRateLimit(req);

    const record =
      existing ??
      new TwoFactorAuthModel({ user_id: user._id, two_factor_enabled: false });

    record.email_enabled = true;
    record.email_confirmed_at = new Date();

    const plaintextCodes = ensureRecoveryCodes(record);
    await record.save();

    res.status(200).json({
      ...statusOf(record),
      recovery_codes: plaintextCodes ?? [],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Sends a code to a signed-in user so they can authorise a change to their
 * factors.
 *
 * Without this an account whose only factor is email could not turn it off:
 * removal costs a code from an enrolled factor, and every other way of getting
 * an emailed one runs through the sign-in challenge, which by definition is not
 * available to someone already signed in. The only way out was to spend a
 * recovery code on a routine settings change.
 *
 * Deliberately issues a `login`-purpose code, which is what
 * `verifyAnyEnrolledFactor` checks — an `enroll` code authorises turning a
 * factor *on*, and the two must not be interchangeable.
 */
export const sendEmailTwoFactorChallenge = async (
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

    const record = await TwoFactorAuthModel.findOne({ user_id: user._id });
    if (!record?.email_enabled) {
      next(createCustomError('Email codes are not set up', 400));
      return;
    }

    if (user.email) {
      await sendLoginEmailCode(user._id.toString(), user.email);
    }

    res.status(200).json({
      sent_to: user.email,
      expires_in_seconds: EMAIL_OTP_TTL_SECONDS,
    });
  } catch (error) {
    next(error);
  }
};

// ─── Removal ─────────────────────────────────────────────────────────────────

/**
 * Removes one factor, or the last one.
 *
 * `method` names what to turn off; omitting it turns everything off. Both cost
 * the password and a working code — see `verifyAnyEnrolledFactor`.
 */
const removeFactor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  method: TwoFactorMethod | 'all',
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const userId = user._id.toString();
    const record = await TwoFactorAuthModel.findOne({ user_id: user._id });

    if (!record || enrolledMethods(record).length === 0) {
      next(createCustomError('Two-factor authentication is not on', 400));
      return;
    }

    if (method === 'totp' && !record.two_factor_enabled) {
      next(createCustomError('No authenticator app is set up', 400));
      return;
    }
    if (method === 'email' && !record.email_enabled) {
      next(createCustomError('Email codes are not set up', 400));
      return;
    }

    // Removing a factor is as sensitive as adding one, so it costs the password
    // as well as a code.
    await assertPassword(userId, req.body?.password);

    const { ok, usedRecoveryIndex } = await verifyAnyEnrolledFactor(
      record,
      userId,
      String(req.body?.code ?? ''),
    );

    if (!ok) {
      next(createCustomError('That code is not correct', 400));
      return;
    }

    await resetRateLimit(req);

    if (usedRecoveryIndex !== -1) {
      record.recovery_codes.splice(usedRecoveryIndex, 1);
    }

    if (method === 'totp' || method === 'all') {
      record.two_factor_enabled = false;
      record.secret = undefined;
      record.confirmed_at = undefined;
      record.expires_at = undefined;
    }
    if (method === 'email' || method === 'all') {
      record.email_enabled = false;
      record.email_confirmed_at = undefined;
      await clearEmailCode(userId, 'login');
      await clearEmailCode(userId, 'enroll');
    }

    // Nothing left to fall back to, so the codes go with the factors.
    if (enrolledMethods(record).length === 0) record.recovery_codes = [];

    const { signedOut } = await finalizeRemoval(record, userId);

    res.status(200).json({ ...statusOf(signedOut ? null : record), signedOut });
  } catch (error) {
    next(error);
  }
};

export const disableTwoFactor = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => removeFactor(req, res, next, 'all');

export const disableTotpTwoFactor = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => removeFactor(req, res, next, 'totp');

export const disableEmailTwoFactor = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => removeFactor(req, res, next, 'email');

// ─── Shared with the sign-in step ────────────────────────────────────────────

/**
 * Sends a login code for an account midway through a two-factor sign-in.
 *
 * Exported for auth.controller, which owns the challenge cookie. Failures to
 * send are logged and swallowed: the caller has already passed the password
 * step, and surfacing SMTP trouble as a 500 there tells an attacker nothing
 * useful while stranding a legitimate user on an error page.
 */
export const sendLoginEmailCode = async (
  userId: string,
  email: string,
): Promise<void> => {
  const issued = await issueEmailCode(userId, 'login');
  if (!issued) return;

  try {
    await sendEmail(
      email,
      'Your sign-in code',
      getTwoFactorCodeEmailHTML(
        issued.code,
        Math.round(EMAIL_OTP_TTL_SECONDS / 60),
        'login',
      ),
    );
  } catch (error) {
    logger.error(`Failed to send two-factor login code: ${String(error)}`);
  }
};
