import { Router, Request, Response } from 'express';
import {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  refreshAccessToken,
  logOut,
  verifyEmail,
  unlockAccount,
  getSessions,
  revokeSessionById,
  revokeAllSessions,
  loginTwoFactor,
  requestTwoFactorEmailCode,
  resendVerificationEmail,
  changePassword,
  changeEmail,
  confirmEmailChange,
  cancelEmailChange,
} from './auth.controller';
import {
  beginEmailTwoFactorSetup,
  beginTwoFactorSetup,
  confirmEmailTwoFactorSetup,
  confirmTwoFactorSetup,
  disableEmailTwoFactor,
  disableTotpTwoFactor,
  disableTwoFactor,
  getTwoFactorStatus,
  sendEmailTwoFactorChallenge,
} from './two-factor.controller';
import { body } from 'express-validator';
import { authenticateToken } from './middlewares/auth.middleware';
import { unauthenticatedGuard } from './middlewares/unauthenticated.middleware';
import {
  loginLimiter,
  forgotPasswordLimiter,
  registerLimiter,
  resetPasswordLimiter,
  accountTokenLimiter,
  resendVerificationLimiter,
  changePasswordLimiter,
  twoFactorCodeLimiter,
  twoFactorEmailSendLimiter,
  twoFactorSetupLimiter,
} from './middlewares/rate-limiter';
import { issueCsrfToken } from './middlewares/csrf.middleware';
import { validateRequest } from './middlewares/validate-request.middleware';
import { checkPassword } from './services/password-policy';

const router = Router();

/**
 * The password rule, delegating to the single policy in
 * `services/password-policy` — which is also what the Mongoose validator and
 * the Angular form use, so all three finally agree.
 *
 * It used to be a composition regex here, a different composition regex in the
 * Angular validator, and `isStrongPassword` on the model. See the note at the
 * top of password-policy.ts for what that cost, and why the replacement has no
 * composition rules at all.
 *
 * Identity context is taken from the same body where it exists (registration
 * carries a username and an address); the routes that set a password for an
 * already-known user re-run the check in their controller, where the account is
 * actually in hand.
 */
const passwordRule = (field: string) =>
  body(field).custom((value: unknown, { req }) => {
    const problems = checkPassword(String(value ?? ''), {
      username: req.body?.username,
      email: req.body?.email,
    });

    // express-validator surfaces one message per failed validator, so the
    // reasons are joined rather than dropped — the client renders the lot.
    if (problems.length > 0) {
      throw new Error(problems.map((problem) => problem.message).join(' '));
    }
    return true;
  });

/*
 * Emails are normalised in one place (auth.service `normalizeEmail`) so every
 * lookup agrees. express-validator's own `normalizeEmail()` is deliberately not
 * used: it strips dots and +tags for Gmail, it was applied on login but not on
 * forgot-password, and the mismatch meant affected users could sign in but
 * could never receive a reset mail.
 */
const validateRegistration = [
  body('email').isEmail().withMessage('Valid email required'),
  body('username')
    .trim()
    .isLength({ min: 3, max: 32 })
    .withMessage('Username must be between 3 and 32 characters')
    .matches(/^[a-zA-Z0-9._-]+$/)
    .withMessage(
      'Username may only contain letters, numbers, dots, underscores and hyphens',
    ),
  body('first_name')
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('First name is required'),
  body('last_name')
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('Last name is required'),
  passwordRule('password'),
];

const validateLogin = [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').exists().withMessage('Password required'),
];

const validateResetPassword = [
  body('token').isString().notEmpty().withMessage('Token required'),
  body('userId').isMongoId().withMessage('Valid user id required'),
  passwordRule('new_password'),
];

/**
 * The current password is only ever compared against a hash, so it carries no
 * format requirement — rules change over time and an account set up under an
 * older one must still be able to move off it.
 */
const validateChangePassword = [
  body('current_password')
    .isString()
    .notEmpty()
    .withMessage('Your current password is required'),
  passwordRule('new_password'),
];

/**
 * Hands the SPA a CSRF token before it has a session. Double-submit needs the
 * client to hold a token *before* its first mutating request, and login is a
 * mutating request — without this, login and register could not be covered.
 */
router.get('/csrf', (req: Request, res: Response) => {
  res.status(200).json({ csrfToken: issueCsrfToken(res) });
});

/*
 * Limiters sit *after* validation on the endpoints they ration by volume rather
 * than by failure (register, forgot-password). Those count every request that
 * reaches them, so in front of the validators a user fumbling the password
 * rules would spend their whole allowance on requests that never did anything.
 */
router.post(
  '/register',
  unauthenticatedGuard,
  validateRegistration,
  validateRequest,
  registerLimiter,
  registerUser,
);
router.post(
  '/login',
  loginLimiter,
  unauthenticatedGuard,
  validateLogin,
  validateRequest,
  loginUser,
);
// Second step of a two-factor sign-in. Rate limited like the first: it is a
// six-digit secret and brute force is the obvious attack.
router.post('/login/2fa', twoFactorCodeLimiter, loginTwoFactor);
/*
 * Asks for an emailed code partway through a sign-in. On the send limiter
 * rather than the code limiter: this one does not verify anything, so counting
 * it against the guessing budget would let a user who asked for a second code
 * spend the attempts they need to use the first one.
 */
router.post(
  '/login/2fa/email',
  twoFactorEmailSendLimiter,
  requestTwoFactorEmailCode,
);

// Enrolment lives behind a session — you must already be signed in to add,
// confirm or remove a second factor. Every mutating one is rate limited: the
// codes are six digits and these routes verify them.
router.get('/2fa', authenticateToken, getTwoFactorStatus);
router.post(
  '/2fa/setup',
  authenticateToken,
  twoFactorSetupLimiter,
  beginTwoFactorSetup,
);
router.post(
  '/2fa/confirm',
  authenticateToken,
  twoFactorCodeLimiter,
  confirmTwoFactorSetup,
);

// The email factor, enrolled the same way: prove the password, then prove a
// delivered code came back. The send is rationed separately from the guesses.
router.post(
  '/2fa/email/setup',
  authenticateToken,
  twoFactorEmailSendLimiter,
  beginEmailTwoFactorSetup,
);
router.post(
  '/2fa/email/confirm',
  authenticateToken,
  twoFactorCodeLimiter,
  confirmEmailTwoFactorSetup,
);

/*
 * A code for a signed-in user about to change their factors. Without it an
 * account whose only factor is email had no way to turn it off but to spend a
 * recovery code.
 */
router.post(
  '/2fa/email/send',
  authenticateToken,
  twoFactorEmailSendLimiter,
  sendEmailTwoFactorChallenge,
);

/*
 * Removal, per factor and wholesale. `DELETE /2fa` keeps meaning "turn it all
 * off" so an older client stays correct; the two specific routes exist because
 * an account can now hold both, and turning one off must not take the other
 * with it.
 */
router.delete(
  '/2fa/totp',
  authenticateToken,
  twoFactorCodeLimiter,
  disableTotpTwoFactor,
);
router.delete(
  '/2fa/email',
  authenticateToken,
  twoFactorCodeLimiter,
  disableEmailTwoFactor,
);
router.delete('/2fa', authenticateToken, twoFactorCodeLimiter, disableTwoFactor);

/*
 * Deliberately not behind `authenticateToken`. Signing out is how a client
 * disposes of cookies, and the moment it needs most is the one where the access
 * token has already expired — where that guard answers 401 and the cookies stay
 * in the browser. `logOut` derives the account from the tokens it was handed and
 * only ever revokes the caller's own credentials, so there is nothing here to
 * authorise; CSRF still applies, so a third-party page cannot force it.
 */
router.post('/logout', logOut);

// Session management for the security screen.
router.get('/sessions', authenticateToken, getSessions);
router.delete('/sessions', authenticateToken, revokeAllSessions);
router.delete('/sessions/:id', authenticateToken, revokeSessionById);

/*
 * Rotating a password you still know, which is not the same operation as
 * recovering one you have lost — and until now only the second existed. The
 * limiter sits after validation so a user fumbling the new-password rules does
 * not spend their allowance on requests that never reached the handler; it
 * still counts every attempt that gets as far as verifying the old password.
 */
router.post(
  '/change-password',
  authenticateToken,
  validateChangePassword,
  validateRequest,
  changePasswordLimiter,
  changePassword,
);

/*
 * Changing the address the account is recovered through. Shares the
 * change-password limiter's budget deliberately: both verify the current
 * password, so they are the same guessing surface and a separate counter would
 * just double the allowance.
 */
router.post(
  '/change-email',
  authenticateToken,
  body('new_email').isEmail().withMessage('Valid email required'),
  body('password').isString().notEmpty().withMessage('Password required'),
  validateRequest,
  changePasswordLimiter,
  changeEmail,
);
// Opened from the link in the new inbox, which is rarely the browser holding
// the session — so no authenticateToken here.
router.post('/confirm-email', resetPasswordLimiter, confirmEmailChange);
router.post('/cancel-email-change', authenticateToken, cancelEmailChange);

router.post(
  '/forgot-password',
  body('email').isEmail().withMessage('Valid email required'),
  validateRequest,
  forgotPasswordLimiter,
  forgotPassword,
);
// Its own limiter, not forgot-password's: requesting a reset mail and guessing
// a reset token are different activities with different budgets, and sharing a
// key prefix meant each drained the other's.
router.post(
  '/reset-password',
  resetPasswordLimiter,
  validateResetPassword,
  validateRequest,
  resetPassword,
);
router.post('/verify-email', accountTokenLimiter, verifyEmail);
// Reachable without a verified address, by definition. Authenticated first, so
// the limiter can key on the account rather than on a shared address.
router.post(
  '/resend-verification',
  authenticateToken,
  resendVerificationLimiter,
  resendVerificationEmail,
);
router.post('/unlock-account', accountTokenLimiter, unlockAccount);
router.post('/refresh', refreshAccessToken);

export default router;
