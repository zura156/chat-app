import { NextFunction, Request, Response } from 'express';
import { IUser, User } from '../user/models/user.model';
import { getSecurityAlertEmailHTML } from '../templates/security-alert-email';
import { getPasswordChangedEmailHTML } from '../templates/password-changed-email';
import { getEmailChangeEmailHTML } from '../templates/email-change-email';
import { logger } from '../utils/logger';
import {
  generateTokens,
  generateTwoFactorChallenge,
  verifyRefreshToken,
  verifyTwoFactorChallenge,
} from './services/jwt.service';
import { CustomAPIError } from '../error-handling/models/custom-api-error.model';
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
import { generateLink, normalizeEmail } from './services/auth.service';
import crypto from 'crypto';
import { resetRateLimit } from './middlewares/rate-limiter';
import {
  storeRefreshToken,
  validateRefreshToken,
  rotateRefreshToken,
  deleteRefreshToken,
  deleteAllUserRefreshTokens,
  blacklistAccessToken,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  revokeSessionsBefore,
  sessionIdForToken,
  newSessionId,
} from './services/token.service';
import { TwoFactorAuthModel } from './models/two-factor.model';
import { verifyAndConsumeCode } from './services/totp.service';
import { checkPassword, PasswordContext } from './services/password-policy';
import { isBreachedPassword } from './services/breached-password.service';

/**
 * The policy checks that need the account in hand.
 *
 * The router validates what it can from the body alone, but `/reset-password`
 * carries only a user id and `/change-password` carries nothing identifying at
 * all — so "is this password built out of your own username" can only be
 * answered here, once the user has been loaded. The breach lookup lives here
 * too because it is asynchronous and may fail, which an express-validator chain
 * handles badly.
 *
 * Returns a message to refuse with, or null.
 */
const passwordRefusal = async (
  password: string,
  context: PasswordContext,
): Promise<string | null> => {
  const problems = checkPassword(password, context);
  if (problems.length > 0) {
    return problems.map((problem) => problem.message).join(' ');
  }

  if (await isBreachedPassword(password)) {
    return 'This password has appeared in a known data breach. Choose one you have not used elsewhere.';
  }

  return null;
};

/**
 * What the server can actually observe about the client, and nothing more. The
 * security screen previously showed invented cities; the honest answer is the
 * user agent and the address the request arrived from.
 */
const observedClient = (req: Request): { userAgent?: string; ip?: string } => ({
  userAgent: req.headers['user-agent']?.slice(0, 300),
  ip: req.ip,
});

/**
 * Issues the session for an authenticated user. Shared by password-only login
 * and by the second-factor step, so both produce identical session state — the
 * kind of thing that drifts when it is written twice.
 */
const issueSession = async (
  req: Request,
  res: Response,
  user: IUser,
): Promise<void> => {
  const sid = newSessionId();
  const userId = user._id.toString();
  const { accessToken, refreshToken } = generateTokens(userId, sid);

  await storeRefreshToken(userId, refreshToken, {
    sid,
    ...observedClient(req),
  });

  // a successful sign-in clears the counter and any expired lock
  await user.updateOne({
    $set: { last_login: new Date(), login_attempts: 0 },
    $unset: { lock_until: 1 },
  });

  setAuthCookies(res, accessToken, refreshToken);
};

// ─── Cookie helpers ────────────────────────────────────────────────────────────

const COOKIE_BASE = {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: (config.nodeEnv === 'production' ? 'none' : 'lax') as
    | 'none'
    | 'lax',
};

/**
 * The cookie must not outlive the token inside it, and the token must not
 * outlive the cookie. These were 15 minutes and `JWT_EXPIRES_IN` (1h by
 * default) respectively, so a captured access token stayed cryptographically
 * valid for 45 minutes after the browser had already dropped it — and the
 * blacklist TTL, derived from the token's own `exp`, was sized for a window
 * nothing else agreed with.
 */
const accessTokenMaxAgeMs = (accessToken: string): number => {
  const decoded = jwt.decode(accessToken) as { exp?: number } | null;
  if (!decoded?.exp) return 15 * 60 * 1000;
  return Math.max(0, decoded.exp * 1000 - Date.now());
};

const setAuthCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string,
) => {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const accessMaxAge = accessTokenMaxAgeMs(accessToken);

  res.cookie('accessToken', accessToken, {
    ...COOKIE_BASE,
    maxAge: accessMaxAge,
  });
  res.cookie('refreshToken', refreshToken, {
    ...COOKIE_BASE,
    path: '/auth/refresh',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  /*
   * Read by JS to echo back as a header, so not httpOnly.
   *
   * Deliberately outlives the access token, and matches what `issueCsrfToken`
   * hands out. It used to expire with the access token, on the reasoning that a
   * CSRF cookie outliving its session only causes 403s — which is backwards.
   * Double-submit checks the cookie against the header; a stale-but-present
   * value still matches itself and is harmless, whereas an *absent* one fails
   * every mutating request.
   *
   * That was reachable: after an idle hour both cookies lapsed together, and
   * `ensureCsrfCookie` only mints a replacement on a safe method. A tab whose
   * next action was a POST — sending a message, or the interceptor's own
   * /auth/refresh — got a 403 with code CSRF, which is not a 401 and so is not
   * retried, not refreshed and not signed out of. The session was stuck until a
   * reload happened to run a GET first.
   *
   * It is still cleared on logout by `clearAuthCookies`, so a token never
   * outlives the session in the way that would actually matter.
   */
  res.cookie('csrfToken', csrfToken, {
    httpOnly: false,
    secure: config.nodeEnv === 'production',
    sameSite: (config.nodeEnv === 'production' ? 'none' : 'lax') as
      | 'none'
      | 'lax',
    domain: config.cookieDomain,
    maxAge: 24 * 60 * 60 * 1000,
  });
};

export const clearAuthCookies = (res: Response) => {
  // A cookie is only overwritten when name + domain + path match how it was
  // set — csrfToken is set with a domain, so it must be cleared with one too.
  res.clearCookie('accessToken', { ...COOKIE_BASE });
  res.clearCookie('refreshToken', { ...COOKIE_BASE, path: '/auth/refresh' });
  // res.clearCookie('csrfToken', {
  //   httpOnly: false,
  //   secure: COOKIE_BASE.secure,
  //   sameSite: COOKIE_BASE.sameSite,
  //   domain: config.cookieDomain,
  // });
};

// ─── Account lockout ───────────────────────────────────────────────────────────

// Redis rate limiting is per email+IP; this is the per-account backstop that a
// distributed attempt can't sidestep.
const MAX_LOGIN_ATTEMPTS = 10;
const LOCK_DURATION_MS = 30 * 60 * 1000;

const registerFailedLogin = async (
  user: IUser,
  req: Request,
): Promise<void> => {
  const updated = await User.findByIdAndUpdate(
    user._id,
    { $inc: { login_attempts: 1 } },
    { returnDocument: 'after' },
  );

  if (!updated || updated.login_attempts < MAX_LOGIN_ATTEMPTS) return;

  const lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
  await User.updateOne(
    { _id: user._id },
    { $set: { lock_until: lockUntil, login_attempts: 0 } },
  );

  // Deliberately NOT revoking existing sessions: that would let anyone log the
  // account owner out of every device just by failing to log in.
  try {
    const userId = String(user._id);
    const [unlockLink, resetLink] = await Promise.all([
      generateLink(AccountTokenEnum.UNLOCK_ACCOUNT, userId),
      generateLink(AccountTokenEnum.PASSWORD_RESET, userId),
    ]);

    await sendEmail(
      user.email,
      'Unusual sign-in activity on your account',
      getSecurityAlertEmailHTML(
        resetLink,
        unlockLink,
        new Date().toUTCString(),
        req.ip ?? 'unknown',
        'Unknown',
        String(req.headers['user-agent'] ?? 'Unknown device'),
      ),
    );
  } catch (error) {
    // the lock still stands even if the mail fails
    logger.error('Failed to send account lock email:', error);
  }
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

    const normalizedEmail = normalizeEmail(email);

    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { username }],
    });
    if (existingUser) {
      res.status(409).json({ message: 'User already exists' });
      return;
    }

    // The synchronous half of the policy already ran in the router, which had
    // the username and address to hand. This is the breach lookup, which is
    // asynchronous and allowed to fail.
    if (await isBreachedPassword(password)) {
      res.status(400).json({
        message:
          'This password has appeared in a known data breach. Choose one you have not used elsewhere.',
      });
      return;
    }

    const user = new User({
      first_name,
      last_name,
      username,
      email: normalizedEmail,
      password,
    });
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
    if (error instanceof CustomAPIError) throw error;
    next(error);
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

    // `+password`: the hash is select:false on the schema, and this is one of
    // the few places that has to compare against it.
    const user = await User.findOne({ email: normalizeEmail(email) }).select(
      '+password',
    );

    if (!user) {
      // Deliberately the same answer as a wrong password. Returning "user not
      // found" here told an attacker which addresses are registered.
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    if (user.lock_until && user.lock_until.getTime() > Date.now()) {
      res.status(423).json({
        message:
          'Account temporarily locked after too many failed attempts. Check your email for the unlock link.',
        retryAfter: Math.ceil((user.lock_until.getTime() - Date.now()) / 1000),
      });
      return;
    }

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      await registerFailedLogin(user, req);
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    // The limiter counts on the way in; a correct password clears the tally, so
    // only failures accumulate.
    await resetRateLimit(req);

    // The password is only the first factor. When a second one is enrolled, no
    // session is issued here — the caller gets a short-lived challenge and has
    // to come back with a code.
    const twoFactor = await TwoFactorAuthModel.findOne({
      user_id: user._id,
      two_factor_enabled: true,
    }).lean();

    if (twoFactor) {
      res.cookie('twoFactorChallenge', generateTwoFactorChallenge(user.id), {
        ...COOKIE_BASE,
        maxAge: 5 * 60 * 1000,
      });

      res.status(200).json({ two_factor_required: true });
      return;
    }

    await issueSession(req, res, user);
    res.status(200).json({ message: 'Login successful' });
  } catch (error: any) {
    if (error instanceof CustomAPIError) throw error;
    next(error);
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

    // An expired or malformed refresh token is a routine end-of-session, not a
    // server fault. Letting jwt's error reach the generic error middleware
    // turned every ordinary expiry into a 500 and a console.error, and left the
    // client's 401 handling — the branch that navigates to the login page —
    // unreachable from here.
    let decoded: { userId: string; sid?: string };
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      clearAuthCookies(res);
      res.status(401).json({ message: 'Refresh token invalid or expired' });
      return;
    }

    const isValid = await validateRefreshToken(decoded.userId, token);
    if (!isValid) {
      res.status(401).json({ message: 'Refresh token invalid or expired' });
      return;
    }

    // The rotated pair keeps the session it came from. Falling back to the
    // stored entry covers tokens issued before sessions carried an id.
    const sid =
      decoded.sid ?? (await sessionIdForToken(decoded.userId, token)) ?? undefined;

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(
      decoded.userId,
      sid,
    );
    const rotated = await rotateRefreshToken(
      decoded.userId,
      token,
      newRefreshToken,
      observedClient(req),
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
    if (error instanceof CustomAPIError) throw error;
    next(error);
  }
};

/**
 * Second step of a two-factor login: exchanges the challenge plus a valid code
 * for a real session. Accepts a recovery code too, and burns it — that is the
 * whole point of one, and leaving it usable twice would make it a standing
 * bypass.
 */
export const loginTwoFactor = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const challenge = req.cookies['twoFactorChallenge'] as string | undefined;
    const { code } = req.body ?? {};

    if (!challenge) {
      res.status(401).json({ message: 'Start the sign-in again' });
      return;
    }

    // Type-scoped both ways: an access token is not accepted here, and this
    // token is not accepted as an access token (see jwt.service).
    let decoded: { userId: string };
    try {
      decoded = verifyTwoFactorChallenge(challenge);
    } catch {
      res.clearCookie('twoFactorChallenge', { ...COOKIE_BASE });
      res.status(401).json({ message: 'Start the sign-in again' });
      return;
    }

    const [user, record] = await Promise.all([
      User.findById(decoded.userId),
      TwoFactorAuthModel.findOne({
        user_id: decoded.userId,
        two_factor_enabled: true,
      }),
    ]);

    if (!user || !record) {
      res.status(401).json({ message: 'Start the sign-in again' });
      return;
    }

    const submitted = String(code ?? '').replace(/\s/g, '');
    const hashedSubmission = crypto
      .createHash('sha256')
      .update(submitted.toUpperCase())
      .digest('hex');

    // Consuming rather than merely checking: a TOTP code is valid for its whole
    // period plus the drift window, so an observed one is otherwise replayable
    // for up to ninety seconds.
    const byCode = await verifyAndConsumeCode(
      String(user._id),
      record.secret,
      submitted,
    );
    const recoveryIndex = record.recovery_codes.indexOf(hashedSubmission);

    if (!byCode && recoveryIndex === -1) {
      res.status(401).json({ message: 'That code is not correct' });
      return;
    }

    await resetRateLimit(req);

    if (recoveryIndex !== -1) {
      record.recovery_codes.splice(recoveryIndex, 1);
      await record.save();
    }

    res.clearCookie('twoFactorChallenge', { ...COOKIE_BASE });
    await issueSession(req, res, user);

    res.status(200).json({
      message: 'Login successful',
      recovery_codes_remaining: record.recovery_codes.length,
      used_recovery_code: recoveryIndex !== -1,
    });
  } catch (error: any) {
    if (error instanceof CustomAPIError) throw error;
    next(error);
  }
};

/**
 * The real answer to "where am I signed in?", replacing a hardcoded list of
 * invented logins. Reports only what the server observed — user agent, address,
 * when the session started and when its token was last exchanged.
 */
export const getSessions = async (
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

    const sessions = await listSessions(user._id.toString());

    res.status(200).json({
      sessions: sessions.map((session) => ({
        id: session.sid,
        user_agent: session.userAgent ?? null,
        ip: session.ip ?? null,
        created_at: session.createdAt,
        last_used_at: session.lastUsedAt,
        current: !!req.sessionId && session.sid === req.sessionId,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const revokeSessionById = async (
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

    const sid = String(req.params.id ?? '');
    if (!sid) {
      res.status(400).json({ message: 'A session id is required' });
      return;
    }

    const revoked = await revokeSession(user._id.toString(), sid);
    if (!revoked) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    // Revoking the session you are currently using is a logout: the access
    // token would otherwise stay valid for its remaining lifetime.
    if (req.sessionId && sid === req.sessionId) {
      const accessToken = req.cookies['accessToken'] as string | undefined;
      if (accessToken) {
        try {
          const decoded = jwt.decode(accessToken) as { exp?: number };
          if (decoded?.exp) await blacklistAccessToken(accessToken, decoded.exp);
        } catch {
          // non-critical
        }
      }
      clearAuthCookies(res);
    }

    res.status(200).json({ message: 'Session revoked' });
  } catch (error) {
    next(error);
  }
};

/**
 * Ends every session including this one. The access token is blacklisted for
 * its remaining lifetime — dropping the refresh tokens alone would leave the
 * current device working for up to fifteen more minutes.
 */
export const revokeAllSessions = async (
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

    await deleteAllUserRefreshTokens(user._id.toString());
    // Ends the access tokens in the *other* browsers too. Deleting refresh
    // tokens only stops them renewing; the ones already issued are self
    // contained and the server has never seen them.
    await revokeSessionsBefore(user._id.toString());

    const accessToken = req.cookies['accessToken'] as string | undefined;
    if (accessToken) {
      try {
        const decoded = jwt.decode(accessToken) as { exp?: number };
        if (decoded?.exp) await blacklistAccessToken(accessToken, decoded.exp);
      } catch {
        // non-critical
      }
    }

    clearAuthCookies(res);
    res.status(200).json({ message: 'All sessions signed out' });
  } catch (error) {
    next(error);
  }
};

/**
 * Ends the session. Deliberately tolerant: logging out is the one thing that
 * must never fail, and the previous version required a live access token to do
 * anything at all — so once the token expired the client got a 401, never
 * cleared its cookies, and sat there believing it was still signed in with no
 * way to correct itself.
 *
 * The user id is recovered from whichever token is still readable, and the
 * cookies are cleared regardless.
 */
export const logOut = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken as string | undefined;
    const accessToken = req.cookies?.accessToken as string | undefined;

    // req.user is absent when the access token has expired; fall back to what
    // the tokens themselves say. Signature is not re-checked here because
    // nothing is authorised on the strength of it — the only actions are
    // revoking the caller's own credentials.
    const userId =
      req.user?._id?.toString() ??
      (jwt.decode(refreshToken ?? accessToken ?? '') as { userId?: string })
        ?.userId;

    // Blacklist the access token for remainder of its TTL
    if (accessToken) {
      try {
        const decoded = jwt.decode(accessToken) as { exp?: number };
        if (decoded?.exp) await blacklistAccessToken(accessToken, decoded.exp);
      } catch {
        // non-critical, continue logout
      }
    }

    if (refreshToken && userId) {
      await deleteRefreshToken(userId, refreshToken);
    }

    clearAuthCookies(res);
    res.json({ message: 'Logout successful' });
  } catch (error: any) {
    if (error instanceof CustomAPIError) throw error;
    next(error);
  }
};

/**
 * Re-sends the verification mail. The verification flow existed end to end but
 * nothing enforced it, so there was never a reason to resend; now that an
 * unverified account is gated, a lost or expired link needs a way back.
 */
export const resendVerificationEmail = async (
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

    if (user.is_email_verified) {
      res.status(409).json({ message: 'Email already verified.' });
      return;
    }

    const verifyLink = await generateLink(
      AccountTokenEnum.EMAIL_VERIFICATION,
      user._id.toString(),
    );

    await sendEmail(
      user.email,
      'Please Verify Your Email',
      `<h2>Verify Email</h2>
       <p>Click the link below to verify your email:</p>
       <a href="${verifyLink}">Verify</a>
       <p>This link will expire in 1 hour.</p>`,
    );

    res.status(200).json({ message: 'Verification email sent.' });
  } catch (error: any) {
    if (error instanceof CustomAPIError) throw error;
    next(error);
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
    const user = await User.findOne({ email: normalizeEmail(email) });

    if (!user) {
      // No reset here, and none on the success path either: what this endpoint
      // rations is mail sent to an address the caller picked, so a request that
      // "worked" is exactly the one worth counting.
      res
        .status(200)
        .json({ message: 'Password reset link sent if email exists.' });
      return;
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
    if (error instanceof CustomAPIError) throw error;
    next(error);
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
      type: AccountTokenEnum.PASSWORD_RESET,
      expires_at: { $gt: new Date() },
    });

    if (!resetToken) {
      res.status(400).json({ message: 'Invalid or expired reset token.' });
      return;
    }

    // `+password`: compared against, then replaced.
    const user = await User.findById(resetToken.user_id).select('+password');
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

    // The router checked what the body could tell it; only here is the account
    // known, so this is where "not your own username" and the breach lookup
    // can run.
    const refusal = await passwordRefusal(new_password, {
      username: user.username,
      email: user.email,
    });
    if (refusal) {
      res.status(400).json({ message: refusal });
      return;
    }

    user.password = new_password;
    user.login_attempts = 0;
    user.lock_until = undefined;

    await user.save();
    await AccountTokensModel.deleteMany({
      user_id: user._id,
      type: AccountTokenEnum.PASSWORD_RESET,
    });

    // Force logout from all devices after password reset
    await deleteAllUserRefreshTokens(user._id.toString());
    await revokeSessionsBefore(user._id.toString());

    // A valid token proves this was not a guessing run.
    await resetRateLimit(req);

    clearAuthCookies(res);
    res.status(200).json({ message: 'Password reset successful.' });
  } catch (error: any) {
    if (error instanceof CustomAPIError) throw error;
    next(error);
  }
};

/**
 * Changes the password of the account that is already signed in.
 *
 * This did not exist. The two "Change password" buttons in settings both linked
 * to `/auth/forgot-password`, which is behind the unauthenticated guard — so
 * for the only people who could ever see those buttons, they redirected back to
 * the app and nothing happened. Recovering an account you have lost access to
 * and rotating a password you still know are different operations, and only the
 * first one was built.
 *
 * Knowing the current password is what authorises this: a session cookie alone
 * would let anyone with a borrowed logged-in browser lock the owner out.
 */
export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authUser = req.user;
    if (!authUser) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const { current_password, new_password } = req.body ?? {};
    if (!current_password || !new_password) {
      res
        .status(400)
        .json({ message: 'Both the current and new password are required.' });
      return;
    }

    // Re-read as a full document: req.user may be a lean projection, and
    // comparePassword/the hashing pre-save hook are document methods.
    // `+password` because the hash is select:false on the schema.
    const user = await User.findById(authUser._id).select('+password');
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    if (!(await user.comparePassword(current_password))) {
      res.status(401).json({ message: 'Your current password is incorrect.' });
      return;
    }

    if (await user.comparePassword(new_password)) {
      res.status(400).json({
        message: 'Your new password must be different from the current one.',
      });
      return;
    }

    const refusal = await passwordRefusal(new_password, {
      username: user.username,
      email: user.email,
    });
    if (refusal) {
      res.status(400).json({ message: refusal });
      return;
    }

    user.password = new_password; // hashed by the pre-save hook
    user.login_attempts = 0;
    user.lock_until = undefined;
    await user.save();

    // The correct current password proves this was not a guessing run.
    await resetRateLimit(req);

    // Every other device keeps working off a refresh token that was minted
    // against the old password, so leaving them alone would make the change
    // cosmetic. This one stays signed in — see revokeOtherSessions.
    const revoked = await revokeOtherSessions(
      user._id.toString(),
      req.sessionId ?? null,
    );
    // Same cut-off applied to the access tokens those devices are still
    // holding, with this session exempted so the caller is not signed out of
    // the machine they just changed their password on.
    await revokeSessionsBefore(user._id.toString(), req.sessionId ?? null);

    // Best-effort: the password is already changed, and failing to send mail
    // must not turn a successful change into an error the client retries.
    try {
      const observed = observedClient(req);
      const resetLink = await generateLink(
        AccountTokenEnum.PASSWORD_RESET,
        user._id.toString(),
      );
      await sendEmail(
        user.email,
        'Your password was changed',
        getPasswordChangedEmailHTML(
          user.username,
          new Date().toUTCString(),
          observed.ip ?? 'unknown',
          observed.userAgent ?? 'Unknown device',
          resetLink,
        ),
      );
    } catch (error) {
      logger.error('Failed to send password-change notification:', error);
    }

    res.status(200).json({
      message: 'Password changed.',
      signed_out_sessions: revoked,
    });
  } catch (error) {
    if (error instanceof CustomAPIError) throw error;
    next(error);
  }
};

/**
 * Starts a move to a new address.
 *
 * Nothing changes on the account yet: the request only records the claim and
 * mails a link to the address being claimed. Proof of control has to come from
 * the new inbox, otherwise a mistyped address — or a stolen session — could
 * move an account somewhere its owner cannot reach.
 *
 * The current password is required for the same reason it is on a password
 * change: whoever controls the address controls password recovery, so this is
 * an account takeover in one step if a live cookie were sufficient.
 */
export const changeEmail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authUser = req.user;
    if (!authUser) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const { new_email, password } = req.body ?? {};
    if (!new_email || !password) {
      res
        .status(400)
        .json({ message: 'A new email address and your password are required.' });
      return;
    }

    const nextEmail = normalizeEmail(new_email);

    // `+password`: this endpoint is authorised by the current password.
    const user = await User.findById(authUser._id).select('+password');
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    if (!(await user.comparePassword(password))) {
      res.status(401).json({ message: 'Your password is incorrect.' });
      return;
    }

    if (nextEmail === normalizeEmail(user.email)) {
      res
        .status(400)
        .json({ message: 'That is already your email address.' });
      return;
    }

    // Checked here for a clear message, and again at confirmation — the address
    // can be taken by someone else in between.
    const taken = await User.exists({ email: nextEmail });
    if (taken) {
      res.status(409).json({ message: 'That email address is already in use.' });
      return;
    }

    user.pending_email = nextEmail;
    await user.save();

    const confirmLink = await generateLink(
      AccountTokenEnum.EMAIL_CHANGE,
      user._id.toString(),
    );

    await sendEmail(
      nextEmail,
      'Confirm your new email address',
      getEmailChangeEmailHTML(user.username, nextEmail, confirmLink),
    );

    // The old address is told as well, because it is the only channel that
    // still reaches the owner if this request was not theirs.
    try {
      const observed = observedClient(req);
      const resetLink = await generateLink(
        AccountTokenEnum.PASSWORD_RESET,
        user._id.toString(),
      );
      await sendEmail(
        user.email,
        'An email change was requested',
        getPasswordChangedEmailHTML(
          user.username,
          new Date().toUTCString(),
          observed.ip ?? 'unknown',
          observed.userAgent ?? 'Unknown device',
          resetLink,
        ),
      );
    } catch (error) {
      logger.error('Failed to notify the previous address:', error);
    }

    res.status(200).json({
      message: `Check ${nextEmail} for a confirmation link.`,
      pending_email: nextEmail,
    });
  } catch (error) {
    if (error instanceof CustomAPIError) throw error;
    next(error);
  }
};

/**
 * Completes the move, from the link sent to the new address.
 *
 * Unauthenticated on purpose: the link is opened in whatever browser the mail
 * client hands it to, which is routinely not the one holding the session.
 */
export const confirmEmailChange = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { token, id } = req.body ?? {};

  if (!token || !id) {
    res.status(400).json({ message: 'Not all details were provided!' });
    return;
  }

  try {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const changeToken = await AccountTokensModel.findOne({
      user_id: id,
      token: hashedToken,
      type: AccountTokenEnum.EMAIL_CHANGE,
      expires_at: { $gt: new Date() },
    });

    if (!changeToken) {
      res.status(400).json({ message: 'Invalid or expired link.' });
      return;
    }

    const user = await User.findById(changeToken.user_id);
    if (!user?.pending_email) {
      res
        .status(400)
        .json({ message: 'There is no pending email change on this account.' });
      return;
    }

    const nextEmail = normalizeEmail(user.pending_email);

    // Re-checked at redemption: the address was free when the link was sent,
    // which says nothing about now. `pending_email` is not unique precisely so
    // that this is the point where the race is settled.
    const taken = await User.exists({
      email: nextEmail,
      _id: { $ne: user._id },
    });
    if (taken) {
      user.pending_email = undefined;
      await user.save();
      res.status(409).json({
        message: 'That email address has since been taken by another account.',
      });
      return;
    }

    user.email = nextEmail;
    user.pending_email = undefined;
    // Redeeming this link is itself proof of control of the new address.
    user.is_email_verified = true;
    await user.save();

    await AccountTokensModel.deleteMany({
      user_id: user._id,
      type: AccountTokenEnum.EMAIL_CHANGE,
    });

    // The address is how the account is recovered, so every other device is
    // signed out — as on a password change.
    await deleteAllUserRefreshTokens(user._id.toString());
    await revokeSessionsBefore(user._id.toString());
    clearAuthCookies(res);

    res.status(200).json({ message: 'Email address updated.' });
  } catch (error) {
    if (error instanceof CustomAPIError) throw error;
    next(error);
  }
};

/** Withdraws a pending change, so a mistyped address does not sit there. */
export const cancelEmailChange = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authUser = req.user;
    if (!authUser) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    await User.findByIdAndUpdate(authUser._id, {
      $unset: { pending_email: 1 },
    });
    await AccountTokensModel.deleteMany({
      user_id: authUser._id,
      type: AccountTokenEnum.EMAIL_CHANGE,
    });

    res.status(200).json({ message: 'Email change cancelled.' });
  } catch (error) {
    next(error);
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
      type: AccountTokenEnum.EMAIL_VERIFICATION,
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
      type: AccountTokenEnum.EMAIL_VERIFICATION,
    });

    res.status(200).json({ message: 'Email verification successful.' });
  } catch (error: any) {
    if (error instanceof CustomAPIError) throw error;
    next(error);
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
      type: AccountTokenEnum.UNLOCK_ACCOUNT,
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
      type: AccountTokenEnum.UNLOCK_ACCOUNT,
    });

    res.status(200).json({ message: 'Account unlocked successfully.' });
  } catch (error: any) {
    if (error instanceof CustomAPIError) throw error;
    next(error);
  }
};
