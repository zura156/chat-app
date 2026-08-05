import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { User } from '../user/models/user.model';
import { logger } from '../utils/logger';

/*
 * One-off: grandfather accounts that predate email-verification enforcement.
 *
 * The verification flow — token, mail, endpoint, `is_email_verified` on the
 * user — shipped long before anything read the flag. So every account created
 * up to now has it `false` regardless of whether the person actually clicked
 * the link, and switching REQUIRE_EMAIL_VERIFICATION on without this locks out
 * the entire existing user base in one deploy.
 *
 * These accounts were implicitly trusted for as long as the gate did not exist.
 * Marking them verified preserves that; it does not weaken anything, because
 * nothing was being enforced against them in the first place. Accounts created
 * after this runs are gated normally.
 *
 *   npm run backfill:verified          # apply
 *   npm run backfill:verified -- --dry # count only, change nothing
 *
 * Run it, confirm the count looks right, then set
 * REQUIRE_EMAIL_VERIFICATION=true.
 */

const backfill = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry');

  await connectDB();

  // Everything that exists at this instant. A registration landing mid-run is
  // deliberately excluded: it is a new account and should verify normally.
  const cutoff = new Date();

  const filter = {
    is_email_verified: { $ne: true },
    createdAt: { $lt: cutoff },
  };

  const affected = await User.countDocuments(filter);

  if (affected === 0) {
    logger.info('Nothing to backfill: no unverified accounts predate the cutoff.');
    return;
  }

  if (dryRun) {
    logger.info(
      `[dry run] ${affected} account(s) would be marked verified (created before ${cutoff.toISOString()}).`,
    );
    return;
  }

  const result = await User.updateMany(filter, {
    $set: { is_email_verified: true },
  });

  logger.info(
    `Backfilled ${result.modifiedCount} of ${affected} account(s) as verified (created before ${cutoff.toISOString()}).`,
  );
};

backfill()
  .catch((error) => {
    logger.error('Backfill failed', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
