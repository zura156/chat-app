import { NextFunction, Response } from 'express';
import { Types } from 'mongoose';
import { AuthRequest } from '../../auth/middlewares/auth.middleware';
import { Upload } from '../../upload/upload.model';
import { User } from '../models/user.model';
import { Conversation } from '../../messenger/models/conversation.model';
import { Message } from '../../messenger/models/message.model';
import { withPrivacyDefaults } from '../services/privacy.service';

/*
 * The data & storage screen showed invented figures — "Images 128 MB, 42%" and
 * so on — and a Clear cache button that only rewrote the local array so it
 * looked like it had worked. These are the real numbers, summed from the
 * uploads this user actually owns.
 */

/** Upload contexts grouped the way the settings screen presents them. */
const CATEGORIES: { label: string; contexts: string[] }[] = [
  { label: 'Images', contexts: ['dm-image'] },
  { label: 'Videos', contexts: ['dm-video'] },
  { label: 'Audio', contexts: ['dm-audio'] },
  { label: 'Documents', contexts: ['dm-file'] },
  { label: 'Profile media', contexts: ['avatar', 'group-avatar', 'cover'] },
];

export const getStorageUsage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const userId = new Types.ObjectId(req.user._id.toString());

    // Only uploads that made it through processing occupy real storage; a
    // pending or failed record describes bytes that are not there.
    const rows = await Upload.aggregate<{ _id: string; bytes: number; count: number }>([
      { $match: { userId, status: { $in: ['ready', 'processing'] } } },
      {
        $group: {
          _id: '$context',
          bytes: { $sum: '$fileSize' },
          count: { $sum: 1 },
        },
      },
    ]);

    const bytesByContext = new Map(rows.map((r) => [r._id, r.bytes]));
    const countByContext = new Map(rows.map((r) => [r._id, r.count]));

    const categories = CATEGORIES.map(({ label, contexts }) => ({
      label,
      bytes: contexts.reduce((sum, c) => sum + (bytesByContext.get(c) ?? 0), 0),
      count: contexts.reduce((sum, c) => sum + (countByContext.get(c) ?? 0), 0),
    }));

    const total = categories.reduce((sum, c) => sum + c.bytes, 0);

    res.status(200).json({
      total_bytes: total,
      categories: categories.map((c) => ({
        ...c,
        // Share of this user's own usage. There is no per-account quota to
        // measure against, so a percentage of anything else would be invented.
        percent: total > 0 ? Math.round((c.bytes / total) * 100) : 0,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Everything the account holds, as JSON. Replaces a Request export button whose
 * handler was an empty function body.
 */
export const exportUserData = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const userId = new Types.ObjectId(req.user._id.toString());

    const [profile, conversations, messages, uploads] = await Promise.all([
      User.findById(userId)
        .select('-password -blocked_users')
        .lean(),
      Conversation.find({ participants: userId })
        .select('group_name is_group participants createdAt')
        .lean(),
      Message.find({ sender: userId })
        .select('conversation content type timestamp edited_at deleted_at')
        .sort({ timestamp: 1 })
        .lean(),
      Upload.find({ userId })
        .select('context mimeType fileSize status createdAt')
        .lean(),
    ]);

    res
      .status(200)
      .setHeader('Content-Type', 'application/json')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="chat-app-export-${Date.now()}.json"`,
      )
      .json({
        exported_at: new Date().toISOString(),
        profile: profile
          ? { ...profile, privacy: withPrivacyDefaults(profile.privacy) }
          : null,
        conversations,
        messages,
        uploads,
      });
  } catch (error) {
    next(error);
  }
};
