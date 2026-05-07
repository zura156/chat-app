import config from '../../config/config';
import {
  AccountTokenEnum,
  AccountTokensModel,
} from '../models/account-tokens.model';
import { randomUUID } from 'crypto';
import crypto from 'crypto';

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

        link = `${config.clientUrl}/verify-email?token=${rawToken}&id=${userId}`;
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
