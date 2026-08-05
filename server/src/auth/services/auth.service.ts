import config from '../../config/config';
import {
  AccountTokenEnum,
  AccountTokensModel,
} from '../models/account-tokens.model';
import { randomUUID } from 'crypto';
import crypto from 'crypto';

/**
 * The single rule for turning a submitted address into the one stored on the
 * user. Every path that looks a user up by email must go through this, or they
 * disagree about who the address belongs to.
 *
 * That is not hypothetical: login ran express-validator's `normalizeEmail()`
 * (which strips dots and the +tag for Gmail) while forgot-password only
 * lowercased, so a user who signed up as `Foo.Bar@gmail.com` could log in but
 * could never receive a reset mail — the lookup missed and the endpoint's
 * deliberately vague "sent if it exists" response hid it.
 *
 * Kept intentionally conservative: case and surrounding whitespace only. Two
 * addresses that differ in dots are different mailboxes at most providers, and
 * silently merging them is its own bug.
 */
export const normalizeEmail = (email: string): string =>
  String(email ?? '')
    .trim()
    .toLowerCase();

export const generateLink = async (
  type: AccountTokenEnum,
  userId: string,
): Promise<string> => {
  try {
    const rawToken: string = randomUUID();
    const hashedToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const expires_at = new Date();

    expires_at.setHours(expires_at.getHours() + 1);

    let link: string;
    switch (type) {
      case AccountTokenEnum.UNLOCK_ACCOUNT:
        await AccountTokensModel.deleteMany({ user_id: userId, type });

        link = `${config.clientUrl}/auth/unlock-account?token=${rawToken}&id=${userId}`;
        break;
      case AccountTokenEnum.PASSWORD_RESET:
        await AccountTokensModel.deleteMany({ user_id: userId, type });

        link = `${config.clientUrl}/auth/reset-password?token=${rawToken}&id=${userId}`;
        break;
      case AccountTokenEnum.EMAIL_VERIFICATION:
        await AccountTokensModel.deleteMany({ user_id: userId, type });

        // must match the Angular route (auth.routes.ts), otherwise the link
        // lands on the catch-all user page and bounces off the auth guard
        link = `${config.clientUrl}/auth/verify-email?token=${rawToken}&id=${userId}`;
        break;
      case AccountTokenEnum.EMAIL_CHANGE:
        await AccountTokensModel.deleteMany({ user_id: userId, type });

        link = `${config.clientUrl}/auth/confirm-email?token=${rawToken}&id=${userId}`;
        break;
      default:
        throw new Error('Invalid token type');
    }

    await AccountTokensModel.findOneAndUpdate(
      { user_id: userId, type },
      { token: hashedToken, expires_at },
      { upsert: true, returnDocument: 'after' },
    );

    return link;
  } catch (error) {
    throw new Error('Error generating a link');
  }
};
